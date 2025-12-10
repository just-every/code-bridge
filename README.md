# @just-every/code-bridge

Development-only bridge that captures errors, logs, and optional controls from your app and streams them to a workspace host. Works across web, Node.js, React Native, Roblox/Lua (HTTP), and thin backend SDKs.

## Links
- Usage & configuration: [docs/usage.md](docs/usage.md)
- Language quickstarts: [docs/clients/README.md](docs/clients/README.md)
- SDK status matrix: [docs/clients/status.md](docs/clients/status.md)
- Roblox / Lua guide: [docs/clients/roblox.md](docs/clients/roblox.md)

## Install (JS/TS)
```bash
npm install @just-every/code-bridge
# or yarn add / pnpm add
```

## Quickstart (JS/TS)
1) Start the host (writes `.code/code-bridge.json` with `url` + `secret`):
```bash
npx code-bridge-host
```
2) Bootstrap the bridge early in your app:
```ts
import { startBridge } from '@just-every/code-bridge';

startBridge({
  url: process.env.CODE_BRIDGE_URL,      // or read from .code/code-bridge.json
  secret: process.env.CODE_BRIDGE_SECRET,
  projectId: 'my-app',
  enableControl: false,                  // opt-in features; see docs/usage.md
});
```
3) In React Native, the same call works; in Node.js you can also enable network/control capture.

## Other runtimes (preview / experimental)
Export `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` (read them from `.code/code-bridge.json`), then run:

| Language | Dev one-liner | Docs |
| --- | --- | --- |
| Roblox / Lua | `npm run copy:lua-client` (then require `CodeBridge.lua`) | [guide](docs/clients/roblox.md) |
| Python | `python python/examples/basic_usage.py` | [guide](docs/clients/python.md) |
| Go | `go run go/examples/main.go` | [guide](docs/clients/go.md) |
| PHP | `php php/examples/basic.php` | [guide](docs/clients/php.md) |
| Ruby | `bundle exec ruby ruby/examples/basic.rb` | [guide](docs/clients/ruby.md) |
| Rust | `cargo run --example basic --manifest-path rust/Cargo.toml` | [guide](docs/clients/rust.md) |
| Swift | `swift run --package-path swift CodeBridgeExample` | [guide](docs/clients/swift.md) |
| Java (scaffold) | `npm run sdk:java` | [guide](docs/clients/java.md) |

## Host in one paragraph
`code-bridge-host` is a singleton WebSocket server per workspace. It locks at `.code/code-bridge.lock`, writes `.code/code-bridge.json` with `url`, `port`, and `secret`, and fans out events from bridges to consumers (e.g., Code, MCP). Start it with `npx code-bridge-host [workspace-path]`.

## Demos & tests (JS/TS)
- Node demo: `npm test` (runs `demo/node-demo.js`, assumes host running)
- Web demo: `npm run build` then open `demo/web-demo.html`
- Workspace bridge demo: `node demo/workspace-bridge-demo.js /path/to/workspace`

## License
MIT
