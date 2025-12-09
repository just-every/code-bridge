import Foundation

public struct BridgeConfig {
    public var url: URL
    public var secret: String
    public var projectId: String?
    public var capabilities: [String]
    public init(url: URL, secret: String, projectId: String? = nil, capabilities: [String] = ["console", "error"]) {
        self.url = url
        self.secret = secret
        self.projectId = projectId
        self.capabilities = capabilities
    }
}

public actor CodeBridgeClient {
    public static let protocolVersion = 2
    public static let heartbeatInterval: TimeInterval = 15
    public static let heartbeatTimeout: TimeInterval = 30

    private let config: BridgeConfig
    private var task: URLSessionWebSocketTask?

    public init(config: BridgeConfig) {
        self.config = config
    }

    public func start() async throws {
        let session = URLSession(configuration: .default)
        let request = URLRequest(url: config.url)
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        try await send(["type": "auth", "secret": config.secret, "role": "bridge"])
        try await send([
            "type": "hello",
            "capabilities": config.capabilities,
            "platform": "swift",
            "projectId": config.projectId as Any,
            "protocol": Self.protocolVersion
        ])
        startHeartbeat()
    }

    public func stop() {
        task?.cancel(with: .goingAway, reason: nil)
    }

    public func sendConsole(_ message: String, level: String = "info") async throws {
        try await send(["type": "console", "level": level, "message": message, "timestamp": nowMs()])
    }

    public func sendError(_ message: String) async throws {
        try await send(["type": "error", "message": message, "timestamp": nowMs()])
    }

    private func send(_ dict: [String: Any]) async throws {
        guard let task else { throw NSError(domain: "codebridge", code: 1) }
        let data = try JSONSerialization.data(withJSONObject: dict, options: [])
        try await task.send(.data(data))
    }

    private func startHeartbeat() {
        Task.detached { [weak task] in
            guard let task else { return }
            while task.closeCode == .invalid {
                try? await task.send(.string("{\"type\":\"ping\"}"))
                try? await Task.sleep(nanoseconds: UInt64(Self.heartbeatInterval * 1_000_000_000))
            }
        }
    }

    private func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
