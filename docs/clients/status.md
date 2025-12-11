# Cross-Language SDK Status

## Coverage matrix

| Language | Maturity | Heartbeat | Reconnect | Buffering | Install (registry) | Dev one-liner |
|---|---|---|---|---|---|---|
| JS/TS (web/Node/RN) | Stable | Yes (15s/30s) | Yes | Yes (200, drop oldest) | `npm install @just-every/code-bridge` | n/a |
| Roblox / Lua (HTTP) | Preview | Poll (HTTP) | n/a (poll loop) | Batches (server HTTP) | copy `lua/CodeBridge.lua` | `npm run copy:lua-client` |
| Python | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | `pip install code-bridge-client` (after publish) | `npm run sdk:python` |
| Go | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | `go install github.com/just-every/code-bridge/go/codebridge@latest` | `npm run sdk:go` |
| PHP | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | `composer require just-every/code-bridge-php` (after publish) | `npm run sdk:php` |
| Ruby | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | `gem install code-bridge` (after publish) | `npm run sdk:ruby` |
| Rust | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | `cargo add code-bridge-client` (after publish) | `npm run sdk:rust` |
| Swift | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | SPM: `https://github.com/just-every/code-bridge.git` | `npm run sdk:swift` |
| Java | Preview | Yes (15s/30s) | Yes (1s→30s + jitter) | Yes (200, drop oldest + notice) | Maven (after publish): groupId `com.jestevery`, artifactId `code-bridge-java`, version `0.1.0` | `npm run sdk:java` |

**Recommended usage**
- Prefer JS/TS in web/Node/RN; Python/Go for service backends; use others for early experimentation only.
- Run the dev one-liner for quick verification; use registry installs once published for app integration.

## Gaps & next steps

### JavaScript / TypeScript
- Stable reference implementation; heartbeat 15s/timeout 30s; exponential backoff 1s→30s; buffering with drop count.
- Gaps: none.

### Roblox / Lua (HTTP)
- State: HTTP polling client for Studio-only dev; batches console/error; polls control requests.
- Gaps: No WebSocket transport; limited reconnect/backoff; Studio-only.

### Python
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered sends (200, drop-oldest + notice); control_request/response; parity tests passing locally and in CI (Python 3.11).
- Gaps: Publish to PyPI.

### Go
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered sends (200, drop-oldest + notice); control_request/response; parity tests covered in CI (Go 1.22.x on ubuntu-latest). Local macOS run pending here (Go toolchain not installed); prior guidance still recommends `CGO_ENABLED=0` when needed.
- Gaps: Publish tags; keep CI green; document `CGO_ENABLED=0` workaround on macOS if needed.

### PHP
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered send (200, drop-oldest + single drop notice); control_request/response; protocol host + PHPUnit tests in repo; CI runs PHPUnit on ubuntu-latest (PHP 8.2). Local run pending (toolchain not available here).
- Gaps: Publish to Packagist; keep CI green; consider dev-friendly defaults toggle like JS; optional local toolchain setup for macOS.

### Ruby
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered sends (200, drop-oldest + notice); control_request/response; Node host + Minitest parity tests passing locally and in CI.
- Gaps: Publish gem; keep CI green.

### Rust
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered sends (200, drop-oldest + notice); control_request/response; parity tests passing locally and in CI (stable).
- Gaps: Publish crate; consider multi-toolchain CI.

### Swift
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered sends (200, drop-oldest + notice); control_request/response; XCTest + Node host; parity tests passing locally and covered by CI on macos-latest.
- Gaps: Publish/tag for SPM consumption; keep CI green.

### Java
- State: Heartbeat 15s/30s; reconnect 1s→30s with jitter; buffered sends (200, drop-oldest + single drop notice); control_request/response; JUnit parity tests covered in CI (Temurin 17). Local run pending on this host due to JDK version.
- Gaps: Publish to Maven Central; consider multi-JDK matrix; logger/redaction for very large payloads.
