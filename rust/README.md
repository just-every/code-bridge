# Rust Code Bridge Client

## One-liner
From repo root: `npm run sdk:rust`

## Features
- Auth → waits for `auth_success`, then sends `hello` (protocol v2)
- Heartbeat ping/pong (15s/30s defaults) with timeout-driven reconnect
- Reconnect with exponential backoff + jitter (1s→30s)
- Buffered sends (default 200, drop-oldest) with a single drop-count notice
- Control requests via `on_control`

## API
- `BridgeClient::new(BridgeConfig)`
- `run_with_reconnect()` runs managed loop with heartbeat/reconnect/buffering
- `send_console(level, message)` / `send_error(message)` enqueue events safely
- `on_control(|msg| -> Result<Value, String>)` to handle control requests

## Example
```
cargo run --example basic
```

## Tests
```
cargo test
```
Parity tests cover handshake ordering, buffering/drop notice, control round-trip, and heartbeat reconnect. CI runs in `.github/workflows/lang-parity-php-swift.yml` (stable toolchain on ubuntu-latest).
