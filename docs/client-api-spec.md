# Client API Spec (shared across SDKs)

This spec defines the common surface every Code Bridge client SDK should expose, regardless of language. It mirrors the protocol in `protocol/schema.json` and the shared runtime constants exported from `src/constants.ts`.

## Core types
- **BridgeConfig**: connection + behavior
  - `url` (string): WebSocket endpoint
  - `secret` (string): shared secret
  - `projectId?` (string): optional project/workspace identifier
  - `capabilities` (string[]): subset of canonical capability names (`console`, `error`, `pageview`, `navigation`, `network`, `screenshot`, `control`)
  - `enabled?` (bool): force on/off; default auto-enable in dev with url/secret
  - `heartbeatIntervalMs?`, `heartbeatTimeoutMs?`, `reconnectInitialDelayMs?`, `reconnectMaxDelayMs?`, `bufferLimit?`: override defaults published in constants
  - `maxBreadcrumbs?` (number)
  - `logger?` (callback/func): debug logging sink
  - `screenshotProvider?` (callback): only for SDKs that can capture images

- **BridgeClient**: lifecycle + event helpers
  - `start()/connect()`: open WS, send `auth`, then `hello` with `protocol` version
  - `stop()/disconnect()`: graceful shutdown, cancel heartbeats
  - `isConnected()/status()`: state query
  - `sendEvent(event)`: generic sender for protocol events
  - Convenience helpers: `log/console`, `error`, `pageview`, `navigation`, `network`, `screenshot`, `sendControl`, `onControl`
  - `on(type, handler)` / `off(type, handler)`: subscribe to incoming frames (pong, control_result, etc.)

## Lifecycle (happy path)
1) Open WebSocket
2) Send `auth {secret, role=bridge, clientId?}`
3) Wait for `auth_success`
4) Send `hello {capabilities, platform, projectId?, protocol=PROTOCOL_VERSION}`
5) Start heartbeat: send `ping` at `HEARTBEAT_INTERVAL_MS`, close if no `pong` before `HEARTBEAT_TIMEOUT_MS`
6) Buffer outbound events until WS is open; flush on open
7) Auto-reconnect with backoff (`RECONNECT_INITIAL_DELAY_MS` → `RECONNECT_MAX_DELAY_MS`)

## Error handling expectations
- Never crash host app; surface errors via callbacks/promises and optional logger.
- Redact obvious secret/token/password fields and truncate oversized messages (align with JS behavior).
- Backpressure: drop oldest when buffer exceeds `bufferLimit`, emit a single info event with drop count.

## Async style per language
- JS/TS, Python, Rust, Swift, Java: async/await or futures
- Go: context-aware blocking calls + goroutines
- PHP/Ruby: blocking by default; allow event loop adapters where idiomatic

## Conformance
- Validate outbound/inbound frames against `protocol/schema.json` where practical.
- Use fixtures in `protocol/fixtures/` and the headless `protocol:test-server` harness for CI.
