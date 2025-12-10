# Cross-Language SDK Status

## Coverage matrix

| Language | Maturity | Heartbeat | Reconnect | Buffering | Install (registry) | Dev one-liner |
|---|---|---|---|---|---|---|
| JS/TS (web/Node/RN) | Stable | Yes (15s/30s) | Yes | Yes (200, drop oldest) | `npm install @just-every/code-bridge` | n/a |
| Roblox / Lua (HTTP) | Preview | Poll (HTTP) | n/a (poll loop) | Batches (server HTTP) | copy `lua/CodeBridge.lua` | `npm run copy:lua-client` |
| Python | Preview | Yes (15s/30s) | Yes (1s→30s backoff) | Basic (queue, drop oldest) | `pip install code-bridge-client` (after publish) | `npm run sdk:python` |
| Go | Preview | Yes (15s/30s) | Yes (1s→30s backoff) | No | `go install github.com/just-every/code-bridge/go/codebridge@latest` | `npm run sdk:go` |
| PHP | Experimental | No | No | No | `composer require just-every/code-bridge-php` (after publish) | `npm run sdk:php` |
| Ruby | Experimental | Yes (ping loop) | No | No | `gem install code-bridge` (after publish) | `npm run sdk:ruby` |
| Rust | Experimental | Yes (ping loop) | No | No | `cargo add code-bridge-client` (after publish) | `npm run sdk:rust` |
| Swift | Experimental | Yes (ping loop) | No | No | SPM: `https://github.com/just-every/code-bridge.git` | `npm run sdk:swift` |
| Java (scaffold) | Experimental | No | No | No | Maven (after publish): groupId `com.jestevery`, artifactId `code-bridge-java`, version `0.1.0` | `npm run sdk:java` |

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
- State: Heartbeat 15s/30s; reconnect 1s→30s; basic buffering; protocol harness tests.
- Gaps: No jitter; buffering/drop reporting minimal; not yet published to PyPI.

### Go
- State: Heartbeat 15s/30s; reconnect 1s→30s; harness test; no buffering.
- Gaps: No buffering/drop metrics; no jitter; publish tags pending.

### PHP
- State: Minimal; no heartbeat/reconnect; smoke test only.
- Gaps: Add heartbeat (15s/30s), reconnect 1s→30s, buffering, schema-backed tests, Packagist publish.

### Ruby
- State: Ping loop only; no timeout; no reconnect; smoke test only.
- Gaps: Add timeout+reconnect (1s→30s), buffering, schema-backed tests, publish gem.

### Rust
- State: Ping loop only; optional reconnect helper; no buffering; smoke test only.
- Gaps: Add timeout+reconnect, buffering/drop reporting, schema-backed tests, publish flag.

### Swift
- State: Ping loop only; no reconnect/backoff; smoke test only.
- Gaps: Add reconnect/backoff, buffering, schema-backed tests, tag for SPM consumption.

### Java
- State: Scaffold only; implementation and tests not yet added.
- Gaps: Implement client (auth/hello, ping/pong, reconnect, buffering), add schema-backed tests, publish-ready metadata.
