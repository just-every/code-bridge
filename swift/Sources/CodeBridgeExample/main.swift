import Foundation
import CodeBridgeClient

@main
struct ExampleApp {
    static func main() async {
        let url = URL(string: ProcessInfo.processInfo.environment["CODE_BRIDGE_URL"] ?? "ws://localhost:9877")!
        let secret = ProcessInfo.processInfo.environment["CODE_BRIDGE_SECRET"] ?? "dev-secret"
        let client = CodeBridgeClient(config: BridgeConfig(url: url, secret: secret, projectId: "swift-example"))
        try? await client.start()
        try? await client.sendConsole("hello from swift")
        try? await client.sendError("sample error")
        try? await Task.sleep(for: .milliseconds(500))
        await client.stop()
    }
}
