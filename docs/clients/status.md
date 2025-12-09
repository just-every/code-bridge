# Cross-Language SDK Status

| Language | Maturity | Heartbeat | Reconnect | Buffering | Install (registry) | Dev one-liner |
|---|---|---|---|---|---|---|
| JS/TS | Stable | Yes (15s/30s) | Yes | Yes (200, drop oldest) | `npm install @just-every/code-bridge` | n/a |
| Python | Preview | Yes (15s/30s) | Yes (1s→30s backoff) | Basic (queue, drop oldest) | `pip install code-bridge-client` (after publish) | `npm run sdk:python` |
| Go | Preview | Yes (15s/30s) | Yes (1s→30s backoff) | No | `go install github.com/just-every/code-bridge/go/codebridge@latest` | `npm run sdk:go` |
| PHP | Experimental | No | No | No | `composer require just-every/code-bridge-php` (after publish) | `npm run sdk:php` |
| Ruby | Experimental | Yes (ping loop) | No | No | `gem install code-bridge` (after publish) | `npm run sdk:ruby` |
| Rust | Experimental | Yes (ping loop) | No | No | `cargo add code-bridge-client` (after publish) | `npm run sdk:rust` |
| Swift | Experimental | Yes (ping loop) | No | No | SPM: `https://github.com/just-every/code-bridge.git` | `npm run sdk:swift` |
| Java | Experimental | No | No | No | Maven (after publish): groupId `com.jestevery`, artifactId `code-bridge-java`, version `0.1.0` | `npm run sdk:java` |

**Recommended usage**
- Prefer JS/TS in web/Node/RN; Python/Go for service backends; use others for early experimentation only.
- Run the dev one-liner for quick verification; use registry installs once published for app integration.

See `status-gaps.md` for per-language gaps and next steps.
