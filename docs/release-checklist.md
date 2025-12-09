# Release checklist (multi-language)

- JS/TS (npm): `npm version <x.y.z> && npm publish`
- Python (PyPI): bump version in `pyproject.toml`; `pip install build && python -m build && twine upload dist/*`
- PHP (Packagist): tag release; `composer validate`; ensure Packagist webhook runs
- Ruby (RubyGems): bump in `code_bridge.gemspec`; `gem build code_bridge.gemspec && gem push code_bridge-<ver>.gem`
- Rust (crates.io): set `publish = true` when ready; `cargo package && cargo publish`
- Go (module proxy): tag `vX.Y.Z`; verify with `go list -m github.com/just-every/code-bridge/go/codebridge@latest`
- Swift (SPM): tag release; ensure `Package.swift` reachable at tag
- Java (Maven Central): configure staging; `mvn deploy -P release`

Pre-publish protocol validation:
`npm run sdk:php && npm run sdk:ruby && npm run sdk:rust && npm run sdk:swift && npm run sdk:java && npm run sdk:python && npm run sdk:go`
