# Rust Quickstart

Status: **Experimental** (ping heartbeat only; reconnect/backoff optional)

## Install
- Published: `cargo add code-bridge-client` (once released)
- From repo: `cd rust && cargo test`

## Run the example
```bash
npx code-bridge-host
export CODE_BRIDGE_URL=$(node -p "require('./.code/code-bridge.json').url")
export CODE_BRIDGE_SECRET=$(node -p "require('./.code/code-bridge.json').secret")
cargo run --example basic --manifest-path rust/Cargo.toml
```

## Embed in your app
```rust
use code_bridge_client::{BridgeClient, BridgeConfig};

let cfg = BridgeConfig {
    url: std::env::var("CODE_BRIDGE_URL")?,
    secret: std::env::var("CODE_BRIDGE_SECRET")?,
    project_id: Some("rust-app".into()),
    ..BridgeConfig::default()
};
let client = BridgeClient::new(cfg);
let mut ws = client.connect().await?;         // sends auth + hello
client.send_console(&mut ws, "info", "hi").await?;
client.send_error(&mut ws, "sample error").await?;
```

## API surface
- `connect()` → opens WS, sends `auth` + `hello`
- `run_with_reconnect()` → optional helper that keeps the socket alive with ping + backoff
- `send_console(ws, level, message)` / `send_error(ws, message)`
- Heartbeat: 15s ping
- Reconnect: only when using `run_with_reconnect()` (1s→30s backoff)
- Buffering: none

## Notes & limits
- Console + error events only
- No screenshot/control/network capture yet
- Uses Tokio + `tokio-tungstenite`; bring your own runtime in apps
