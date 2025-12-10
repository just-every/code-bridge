# Client Quickstarts

Thin SDKs in multiple languages share the same protocol and API shape (see `../client-api-spec.md`). Each quickstart follows the same steps:

1) Install the SDK
2) Configure `url` + `secret` (env recommended)
3) Initialize/start the client
4) Send a first event (console/log or pageview)
5) Verify the host received it
6) Next steps for framework integration

Common setup (applies to every SDK):
```
npx code-bridge-host  # writes .code/code-bridge.json with url/secret
export CODE_BRIDGE_URL=$(node -p "require('./.code/code-bridge.json').url")
export CODE_BRIDGE_SECRET=$(node -p "require('./.code/code-bridge.json').secret")
```

Quickstarts:
- [Python](python.md) (preview)
- [Go](go.md) (preview)
- [PHP](php.md) (experimental)
- [Ruby](ruby.md) (experimental)
- [Rust](rust.md) (experimental)
- [Swift](swift.md) (experimental)
- [Java](java.md) (scaffold / WIP)
- Roblox / Lua HTTP: see [roblox.md](roblox.md)

Root-level one-liners (from repo root):
```
npm run sdk:php
npm run sdk:ruby
npm run sdk:rust
npm run sdk:swift
npm run sdk:java
npm run sdk:python
npm run sdk:go
```

Release prep: see `docs/release-checklist.md` for per-registry steps and version bump guidance.

Status/maturity: see `docs/clients/status.md` for feature coverage and recommended usage.
