# Rust Quickstart (skeleton)

## Install
Registry: `cargo add code-bridge-client` (after publishing)
Dev: `cd rust && cargo build`
One-liner dev: `npm run sdk:rust`

## Configure
Read `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` from env; pass into `BridgeConfig`.

## Initialize
Start the async client (Tokio/async runtime), sending `auth` then `hello` with `protocol` version and capabilities.

## Send First Event
Send a log/console event; ensure buffering until connected and heartbeat is running.

## Verify
Run host or `npm run protocol:test-server`; check that the event is received.

## Next Steps
Tie into `tracing`/logging, add control handler futures, and enable optional network/pageview capture.
