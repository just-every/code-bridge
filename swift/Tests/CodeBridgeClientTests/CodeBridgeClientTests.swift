import XCTest
@testable import CodeBridgeClient

final class CodeBridgeClientTests: XCTestCase {
    func testHandshake() async throws {
        let url = URL(string: ProcessInfo.processInfo.environment["CODE_BRIDGE_URL"] ?? "ws://localhost:9877")!
        let secret = ProcessInfo.processInfo.environment["CODE_BRIDGE_SECRET"] ?? "dev-secret"
        let client = CodeBridgeClient(config: BridgeConfig(url: url, secret: secret, projectId: "swift-test"))
        try await client.start()
        try await client.sendConsole("swift smoke")
        client.stop()
    }
}
