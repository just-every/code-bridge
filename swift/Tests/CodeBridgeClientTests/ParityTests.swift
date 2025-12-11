import XCTest
import Darwin
@testable import CodeBridgeClient

final class CodeBridgeClientParityTests: XCTestCase {
  func spawnHost(port: Int, autoPong: Bool = true, sendControl: Bool = false) throws -> (Process, URL) {
    let proc = Process()
    let scriptURL = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // .../CodeBridgeClientTests
      .deletingLastPathComponent() // .../Tests
      .appendingPathComponent("ProtocolHost.js")
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    proc.arguments = ["node", scriptURL.path]
    proc.currentDirectoryURL = scriptURL.deletingLastPathComponent()
    var env = ProcessInfo.processInfo.environment
    env["PORT"] = String(port)
    env["SECRET"] = "dev-secret"
    env["AUTO_PONG"] = autoPong ? "true" : "false"
    env["SEND_CONTROL"] = sendControl ? "true" : "false"
    proc.environment = env
    let logURL = FileManager.default.temporaryDirectory.appendingPathComponent("swift-protocol-host-\(port)-\(UUID().uuidString).log")
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    let fh = try FileHandle(forWritingTo: logURL)
    proc.standardOutput = fh
    proc.standardError = fh
    try proc.run()
    return (proc, logURL)
  }

  func waitForListening(_ logURL: URL, timeout: TimeInterval = 3.0) throws -> [[String: Any]] {
    let deadline = Date().addingTimeInterval(timeout)
    var events: [[String: Any]] = []
    while Date() < deadline {
      events = readEvents(logURL, timeout: 0.1)
      if events.contains(where: { ($0["event"] as? String) == "listening" }) {
        return events
      }
      Thread.sleep(forTimeInterval: 0.05)
    }
    return events
  }

  func readEvents(_ logURL: URL, timeout: TimeInterval = 2.0) -> [[String: Any]] {
    let deadline = Date().addingTimeInterval(timeout)
    var events: [[String: Any]] = []
    while Date() < deadline {
      if let data = try? Data(contentsOf: logURL), let text = String(data: data, encoding: .utf8) {
        events = text.split(separator: "\n").compactMap { line in
          guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { return nil }
          return obj
        }
        break
      }
      Thread.sleep(forTimeInterval: 0.05)
    }
    return events
  }

  func testHandshakeBufferingAndDropNotice() async throws {
    let port = 9895
    let (proc, logURL) = try spawnHost(port: port)
    defer { proc.terminate(); proc.waitUntilExit(); try? FileManager.default.removeItem(at: logURL) }
    let initial = try waitForListening(logURL)

    var cfg = BridgeConfig(url: URL(string: "ws://127.0.0.1:\(port)")!, secret: "dev-secret")
    cfg.bufferLimit = 3
    let client = CodeBridgeClient(config: cfg)

    for i in 0..<5 {
      try await client.sendConsole("m\(i)")
    }

    try await client.start()
    // allow some traffic
    try await Task.sleep(nanoseconds: 800_000_000)
    await client.stop()

    let events = initial + readEvents(logURL)
    let recv = events.compactMap { $0["msg"] as? [String: Any] }
    XCTAssertEqual(recv.first?["type"] as? String, "auth")
    XCTAssertEqual(recv.dropFirst().first?["type"] as? String, "hello")
    let consoles = recv.filter { $0["type"] as? String == "console" }.compactMap { $0["message"] as? String }
    XCTAssertEqual(consoles, ["m2", "m3", "m4"])
    let drop = recv.first { ($0["type"] as? String) == "info" }
    XCTAssertNotNil(drop)
    XCTAssertTrue((drop?["message"] as? String ?? "").contains("drop count=2"))
  }

  func testControlRoundTrip() async throws {
    let port = 9896
    let (proc, logURL) = try spawnHost(port: port, sendControl: true)
    defer { proc.terminate(); proc.waitUntilExit(); try? FileManager.default.removeItem(at: logURL) }
    let initial = try waitForListening(logURL)

    let cfg = BridgeConfig(url: URL(string: "ws://127.0.0.1:\(port)")!, secret: "dev-secret")
    let client = CodeBridgeClient(config: cfg)
    await client.onControl { msg in
      if msg["action"] as? String == "echo" {
        return ["echo": msg["args"] ?? [:]]
      }
      throw NSError(domain: "control", code: 1)
    }

    try await client.start()
    try await Task.sleep(nanoseconds: 1_200_000_000)
    await client.stop()

    let events = initial + readEvents(logURL, timeout: 5)
    let ctrl = events.first { ($0["event"] as? String) == "control_result" }
    XCTAssertNotNil(ctrl)
    let msg = ctrl?["msg"] as? [String: Any]
    XCTAssertEqual(msg?["ok"] as? Bool, true)
  }

  func testHeartbeatReconnect() async throws {
    let port = 9897
    let (proc, logURL) = try spawnHost(port: port, autoPong: false)
    defer { proc.terminate(); proc.waitUntilExit(); try? FileManager.default.removeItem(at: logURL) }
    _ = try waitForListening(logURL)

    var cfg = BridgeConfig(url: URL(string: "ws://127.0.0.1:\(port)")!, secret: "dev-secret")
    cfg.heartbeatIntervalMs = 50
    cfg.heartbeatTimeoutMs = 120
    cfg.backoffInitialMs = 50
    cfg.backoffMaxMs = 200
    let client = CodeBridgeClient(config: cfg)

    try await client.start()
    try await Task.sleep(nanoseconds: 3_000_000_000)
    await client.stop()

    let events = readEvents(logURL, timeout: 3)
    let recv = events.compactMap { $0["msg"] as? [String: Any] }
    let hellos = recv.filter { $0["type"] as? String == "hello" }
    XCTAssertGreaterThanOrEqual(hellos.count, 2)
  }
}

// Legacy smoke test retained for quick handshake coverage.
final class CodeBridgeClientSmokeTests: XCTestCase {
  func testHandshake() async throws {
    let port = 9898
    let (proc, _) = try CodeBridgeClientParityTests().spawnHost(port: port)
    try await Task.sleep(nanoseconds: 500_000_000)
    defer { proc.terminate() }

    let cfg = BridgeConfig(url: URL(string: "ws://127.0.0.1:\(port)")!, secret: "dev-secret", projectId: "swift-test")
    let client = CodeBridgeClient(config: cfg)
    try await client.start()
    try await client.sendConsole("swift smoke")
    await client.stop()
  }
}
