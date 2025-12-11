import Foundation

public struct BridgeConfig {
    public var url: URL
    public var secret: String
    public var projectId: String?
    public var capabilities: [String]
    public var heartbeatIntervalMs: Int
    public var heartbeatTimeoutMs: Int
    public var backoffInitialMs: Int
    public var backoffMaxMs: Int
    public var bufferLimit: Int
    public init(
        url: URL,
        secret: String,
        projectId: String? = nil,
        capabilities: [String] = ["console", "error"],
        heartbeatIntervalMs: Int = 15_000,
        heartbeatTimeoutMs: Int = 30_000,
        backoffInitialMs: Int = 1_000,
        backoffMaxMs: Int = 30_000,
        bufferLimit: Int = 200
    ) {
        self.url = url
        self.secret = secret
        self.projectId = projectId
        self.capabilities = capabilities
        self.heartbeatIntervalMs = heartbeatIntervalMs
        self.heartbeatTimeoutMs = heartbeatTimeoutMs
        self.backoffInitialMs = backoffInitialMs
        self.backoffMaxMs = backoffMaxMs
        self.bufferLimit = bufferLimit
    }
}

public actor CodeBridgeClient {
    public static let protocolVersion = 2

    private let config: BridgeConfig
    private var task: URLSessionWebSocketTask?
    private var loopTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var recvTask: Task<Void, Never>?
    private var running = false
    private var authed = false
    private var buffer: [[String: Any]] = []
    private var dropped = 0
    private var controlHandler: (([String: Any]) throws -> Any?)?

    public init(config: BridgeConfig) {
        self.config = config
    }

    public func start() async throws {
        guard !running else { return }
        running = true
        let cfg = self.config
        // Perform the first connect inline so callers return only after the initial handshake succeeds.
        try await connectOnce()

        loopTask = Task { [weak self, cfg] in
            guard let self else { return }
            var delayMs = cfg.backoffInitialMs
            while await self.isRunning() {
                do {
                    try await self.waitForClose()
                } catch {
                    // ignore
                }
                guard await self.isRunning() else { break }
                let jittered = self.jitter(delayMs, maxMs: cfg.backoffMaxMs)
                try? await Task.sleep(nanoseconds: UInt64(jittered) * 1_000_000)
                delayMs = min(delayMs * 2, cfg.backoffMaxMs)
                do {
                    try await self.connectOnce()
                    delayMs = cfg.backoffInitialMs
                } catch {
                    // swallow and continue backoff
                }
            }
        }
    }

    public func stop() {
        running = false
        heartbeatTask?.cancel()
        recvTask?.cancel()
        loopTask?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func isRunning() -> Bool { running }

    public func sendConsole(_ message: String, level: String = "info") async throws {
        try await enqueue(["type": "console", "level": level, "message": message, "timestamp": nowMs()])
    }

    public func sendError(_ message: String) async throws {
        try await enqueue(["type": "error", "message": message, "timestamp": nowMs()])
    }

    public func onControl(_ handler: @escaping ([String: Any]) throws -> Any?) {
        controlHandler = handler
    }

    private func send(_ dict: [String: Any]) async throws {
        guard let task else { throw NSError(domain: "codebridge", code: 1) }
        let data = try JSONSerialization.data(withJSONObject: dict, options: [])
        try await task.send(.data(data))
    }

    private func connectOnce() async throws {
        let session = URLSession(configuration: .default)
        let request = URLRequest(url: config.url)
        let task = session.webSocketTask(with: request)
        self.task = task
        authed = false
        task.resume()

        // auth
        try await send(["type": "auth", "secret": config.secret, "role": "bridge"])
        try await waitForAuthSuccess()

        // hello
        try await send([
            "type": "hello",
            "capabilities": config.capabilities,
            "platform": "swift",
            "projectId": config.projectId as Any,
            "protocol": Self.protocolVersion
        ])

        try await flushBuffer()

        startHeartbeat()
        startReceiver()
    }

    private func waitForAuthSuccess() async throws {
        let deadline = Date().addingTimeInterval(TimeInterval(config.heartbeatTimeoutMs) / 1000)
        while Date() < deadline {
            guard let task else { throw NSError(domain: "codebridge", code: 2) }
            let msg = try await receiveWithTimeout(task, timeoutMs: config.heartbeatTimeoutMs)
            switch msg {
            case .string(let text):
                if let data = text.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = obj["type"] as? String {
                    if type == "auth_success" { authed = true; return }
                    if type == "ping" { try? await send(["type": "pong"])
                    } else if type == "control_request" {
                        await handleControl(obj)
                    }
                }
            case .data(let data):
                if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = obj["type"] as? String, type == "auth_success" {
                    authed = true; return
                }
            @unknown default:
                break
            }
        }
        throw NSError(domain: "codebridge", code: 3, userInfo: [NSLocalizedDescriptionKey: "auth_success timeout"])
    }

    private func receiveWithTimeout(_ ws: URLSessionWebSocketTask, timeoutMs: Int) async throws -> URLSessionWebSocketTask.Message {
        try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
            group.addTask { try await ws.receive() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
                throw NSError(domain: "codebridge", code: 4, userInfo: [NSLocalizedDescriptionKey: "receive timeout"])
            }
            guard let first = try await group.next() else {
                throw NSError(domain: "codebridge", code: 5)
            }
            group.cancelAll()
            return first
        }
    }

    private func startReceiver() {
        recvTask = Task { await self.receiveLoop() }
    }

    private func receiveLoop() async {
        guard let task else { return }
        let timeoutMs = config.heartbeatTimeoutMs
        while running && !Task.isCancelled {
            do {
                let msg = try await receiveWithTimeout(task, timeoutMs: timeoutMs)
                switch msg {
                case .string(let text):
                    if let data = text.data(using: .utf8),
                       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let type = obj["type"] as? String {
                        switch type {
                        case "ping":
                            try? await send(["type": "pong"])
                        case "pong":
                            // reset by continuing loop
                            break
                        case "control_request":
                            await handleControl(obj)
                        default:
                            break
                        }
                    }
                case .data(let data):
                    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let type = obj["type"] as? String, type == "pong" {
                        // reset by continuing loop
                    }
                @unknown default:
                    break
                }
            } catch {
                // timeout or receive error: trigger reconnect
                task.cancel(with: .goingAway, reason: nil)
                break
            }
        }
    }

    private func startHeartbeat() {
        guard let task else { return }
        let intervalNs = UInt64(config.heartbeatIntervalMs) * 1_000_000
        heartbeatTask = Task { [weak task] in
            guard let task else { return }
            while running && !Task.isCancelled && task.closeCode == .invalid {
                try? await task.send(.string("{\"type\":\"ping\"}"))
                try? await Task.sleep(nanoseconds: intervalNs)
            }
        }
    }

    private func enqueue(_ dict: [String: Any]) async throws {
        if let task, task.closeCode == .invalid {
            try await send(dict)
            return
        }
        if buffer.count >= config.bufferLimit {
            buffer.removeFirst()
            dropped += 1
        }
        buffer.append(dict)
    }

    private func flushBuffer() async throws {
        if task == nil { return }
        for ev in buffer { try await send(ev) }
        buffer.removeAll()
        if dropped > 0 {
            try await send(["type": "info", "level": "info", "message": "bridge buffered drop count=\(dropped)"])
            dropped = 0
        }
    }

    private func handleControl(_ msg: [String: Any]) async {
        guard let handler = controlHandler else { return }
        let id = msg["id"] ?? NSNull()
        do {
            let result = try handler(msg)
            try? await enqueue(["type": "control_result", "id": id, "ok": true, "result": result as Any])
        } catch {
            try? await enqueue(["type": "control_result", "id": id, "ok": false, "error": ["message": error.localizedDescription]])
        }
    }

    private func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func waitForClose() async throws {
        guard let task else { return }
        let maxWait = Double(config.heartbeatTimeoutMs) / 1000 * 2 // 2x timeout window
        let deadline = Date().addingTimeInterval(maxWait)
        while task.state == .running && task.closeCode == .invalid && Date() < deadline && running && !Task.isCancelled {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        if task.closeCode == .invalid {
            task.cancel(with: .goingAway, reason: nil)
        }
    }

    nonisolated private func jitter(_ baseMs: Int, maxMs: Int) -> Int {
        let factor = Double.random(in: 1.0...1.5)
        return min(Int(Double(baseMs) * factor), maxMs)
    }
}
