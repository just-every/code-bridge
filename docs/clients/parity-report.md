# Cross-SDK Parity Report (JS reference)

This snapshot summarizes each SDK against the JavaScript reference client (auth→auth_success→hello ordering; heartbeat 15s/timeout 30s; jittered reconnect/backoff; buffered sends with drop‑oldest + single drop notice; control request/response).

Legend for test execution:
- **Local**: executed in this workspace during the latest pass.
- **CI**: covered by current GitHub Actions workflows.
- **Pending**: not run here; rely on future CI or toolchain setup.

## Language breakdown

### JavaScript / TypeScript (reference)
- Features: Full reference implementation (handshake, heartbeat, jittered reconnect, buffering/drop notice, control).
- Tests: Maintainers’ existing suite (not rerun here).
- Status doc: `Stable` row in `docs/clients/status.md`.

### Roblox / Lua (HTTP)
- Features: HTTP polling (console/error batches), control polling; no WebSocket; no reconnect/backoff semantics.
- Tests: Pending (manual only).
- Status doc: Reflects HTTP/polling limitations.

### Python
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s, jittered reconnect, buffer 200 drop‑oldest + notice, control).
- Tests: **Local** `python3 -m pytest` (pass); **CI** in lang parity workflow (Python 3.11).
- Status doc: Preview; local + CI parity.

### Go
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s, jittered reconnect, buffer 200 drop‑oldest + notice, control).
- Tests: **CI** via `lang-parity-php-swift.yml` (Go 1.22.x on ubuntu-latest); **Local** not run on this host (Go toolchain absent; prior guidance uses `CGO_ENABLED=0`).
- Status doc: Preview; CI-covered parity noted, local pending.

### PHP
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s, jittered reconnect, buffer 200 drop‑oldest + notice, control).
- Tests: **CI** (PHP 8.2) in `lang-parity-php-swift.yml`; local run pending (toolchain not available here).
- Status doc: Preview; CI-backed parity noted.

### Ruby
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s, jittered reconnect, buffer 200 drop‑oldest + notice, control).
- Tests: **Local** `bundle exec ruby -Ilib tests/test_client.rb` (pass on macOS/arm64); **CI** in lang parity workflow.
- Status doc: Preview; local + CI parity.

### Rust
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s, jittered reconnect, buffer 200 drop‑oldest + notice, control).
- Tests: **Local** `cargo test -q` (pass); **CI** in lang parity workflow (stable).
- Status doc: Preview; local + CI parity.

### Swift
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s, jittered reconnect, buffer 200 drop‑oldest + notice, control).
- Tests: **Local** `swift test --filter CodeBridgeClientParityTests` (pass); **CI** macos-latest in `lang-parity-php-swift.yml`.
- Status doc: Preview; locally & CI verified.

### Java
- Features: Matches JS semantics (auth gate, heartbeat 15s/30s with timeout reconnect, jittered backoff, buffer 200 drop‑oldest + notice, control).
- Tests: **CI** (Temurin 17) in lang parity workflow; **Local** pending here (JDK ≥11 not available on this host).
- Status doc: Preview; CI parity noted; expand to multi-JDK when available.

## Alignment with docs/clients/status.md
- Rows and “Gaps” now mirror the above: Python/Ruby/Rust/Swift verified locally (Dec 11, 2025); Go/Java/PHP rely on CI parity; JS reference; Roblox noted as HTTP-only.
- Publishing steps (PyPI/gem/crate/Maven/Packagist/SPM tag) remain listed as gaps where applicable.

## Known limitations / follow-ups
- Go/Java/PHP local runs still depend on environment; rely on CI until local toolchains are available here.
- Roblox remains HTTP-only (no WS parity planned).
- Publication to registries and multi-platform CI matrices are still pending for several SDKs.
