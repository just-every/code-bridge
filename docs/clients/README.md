# Client Quickstarts

Thin SDKs in multiple languages share the same protocol and API shape (see `../client-api-spec.md`). Each quickstart follows the same steps:

1) Install the SDK
2) Configure `url` + `secret` (env recommended)
3) Initialize/start the client
4) Send a first event (console/log or pageview)
5) Verify the host received it
6) Next steps for framework integration

Quickstarts:
- [PHP](php.md)
- [Python](python.md)
- [Rust](rust.md)
- [Ruby](ruby.md)
- [Swift](swift.md)
- [Java](java.md)
- [Go](go.md)

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
