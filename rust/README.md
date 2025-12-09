# Rust Code Bridge Client (minimal)

## One-liner
From repo root: `npm run sdk:rust`

## API
- `BridgeClient::new(BridgeConfig)`
- `connect()` -> WebSocket stream with auth + hello (protocol 2)
- `send_console(&mut ws, level, message)`
- `send_error(&mut ws, message)`
- `run_heartbeat(&mut ws)` (simple ping loop)

This is a minimal implementation for development/testing; extend with reconnect/backoff as needed.
