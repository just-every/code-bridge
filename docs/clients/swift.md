# Swift Quickstart

Status: **Experimental** (ping heartbeat only; no reconnect/backoff yet)

## Install
- SPM: add package `https://github.com/just-every/code-bridge.git`
- From repo: `cd swift && swift build`

## Run the example (macOS CLI)
```bash
npx code-bridge-host
export CODE_BRIDGE_URL=$(node -p "require('./.code/code-bridge.json').url")
export CODE_BRIDGE_SECRET=$(node -p "require('./.code/code-bridge.json').secret")
swift run --package-path swift CodeBridgeExample
```

## Embed in your app
```swift
import CodeBridgeClient

let url = URL(string: ProcessInfo.processInfo.environment["CODE_BRIDGE_URL"] ?? "ws://localhost:9877")!
let secret = ProcessInfo.processInfo.environment["CODE_BRIDGE_SECRET"] ?? "dev-secret"
let client = CodeBridgeClient(config: BridgeConfig(url: url, secret: secret, projectId: "ios-app"))

Task {
  try await client.start()
  try await client.sendConsole("hello from swift")
  try await client.sendError("sample error")
}
```

## API surface
- `start()` / `stop()` (async)
- `sendConsole(_ message, level: String = "info")`
- `sendError(_ message)`
- Heartbeat: 15s ping loop
- Reconnect/backoff: **not implemented yet**
- Buffering: none

## Notes & limits
- Console + error events only
- Designed for dev tooling; secure secrets appropriately for device builds
