# Java Code Bridge Client (minimal)

## One-liner
From repo root: `npm run sdk:java`

## API
- `CodeBridgeClient.start()` → builds WebSocket, sends auth + hello (protocol 2)
- `sendConsole(level, message)`
- `sendError(message)`
- `stop()`

Heartbeat not implemented; keep sessions short for now.
