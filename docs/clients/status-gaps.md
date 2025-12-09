# SDK Status & Gaps (Heartbeat/Reconnect/Conformance)

This summarizes current behavior and remaining work per SDK. See `docs/clients/status.md` for feature matrix.

## JavaScript / TypeScript
- **State:** Stable reference implementation; heartbeat 15s/timeout 30s; exponential backoff 1s→30s; buffering with drop count.
- **Gaps:** None (reference).

## Python
- **State:** Heartbeat 15s/30s; reconnect 1s→30s; basic buffering; protocol harness tests.
- **Gaps:** No jitter; buffering/drop reporting is minimal; not yet published to PyPI.

## Go
- **State:** Heartbeat 15s/30s; reconnect 1s→30s; harness test; no buffering.
- **Gaps:** No buffering/drop metrics; no jitter; not yet published to module proxy with version tags.

## PHP
- **State:** Minimal; no heartbeat or reconnect; smoke test only.
- **Gaps:** Add 15s/30s heartbeat; reconnect 1s→30s; buffering; tighter schema validation in tests; publish to Packagist.

## Ruby
- **State:** Ping loop only; no timeout; no reconnect; smoke test only.
- **Gaps:** Add timeout+reconnect (1s→30s); buffering; schema-backed conformance test; publish gem.

## Rust
- **State:** Ping loop only; no timeout; no reconnect; smoke test only.
- **Gaps:** Add timeout+reconnect (1s→30s); buffering/drop reporting; schema-backed conformance test; set publish=true when ready.

## Swift
- **State:** Ping loop only; no timeout; no reconnect; smoke test only.
- **Gaps:** Add timeout+reconnect (1s→30s); buffering; schema-backed test; tag for SPM consumption.

## Java
- **State:** Minimal; no heartbeat/reconnect; JUnit smoke.
- **Gaps:** Add 15s/30s heartbeat; reconnect 1s→30s; buffering; schema-backed test; prep Maven Central metadata.

## General next steps (future hardening)
1) Implement essential heartbeat + reconnect (15s ping, 30s timeout, 1s→30s backoff) for PHP/Ruby/Rust/Swift/Java.
2) Add buffering with drop-count info or document lack thereof for Go/Ruby/Rust/Swift/Java/PHP.
3) Add schema-backed conformance tests per SDK using `tools/protocol-test-server.js` (auth + hello + ping/pong timeouts).
4) Publish-ready metadata and versioned releases to each registry; update install snippets to real versions.
5) Optional polish: jittered backoff, metrics/log hooks, shared fixtures consumption.
