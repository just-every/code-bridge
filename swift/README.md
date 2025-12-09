# Swift Code Bridge Client (minimal)

## One-liner
From repo root (macOS): `npm run sdk:swift`

## API
- `CodeBridgeClient(config:)` with `BridgeConfig(url:secret:projectId:capabilities:)`
- `start()` async sends auth + hello (protocol 2)
- `sendConsole(_:, level:)`
- `sendError(_:)`
- `stop()`

Heartbeat: simple ping loop; production apps should add pong handling/timeouts.
