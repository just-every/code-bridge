# Go Code Bridge Client

## Install from module proxy
```
go install github.com/just-every/code-bridge/go/codebridge@latest
```

## Root one-liner
`npm run sdk:go`

## Features
- Auth + hello handshake (waits for `auth_success` before `hello`)
- Heartbeat ping/pong (15s/30s defaults) with timeout-driven reconnect
- Reconnect with exponential backoff and jitter (1s→30s)
- Buffered sends (200 default, drop-oldest) with a single drop-count notice on flush
- Control request handling via `OnControl(handler)`

## Run tests locally
On macOS set `CGO_ENABLED=0` to avoid dyld LC_UUID issues with test binaries.
```
node tools/protocol-test-server.js --port=9877 --secret=dev-secret &
CGO_ENABLED=0 CODE_BRIDGE_URL=ws://localhost:9877 CODE_BRIDGE_SECRET=dev-secret go test ./...
kill %1
```

CI: Go parity runs in `.github/workflows/lang-parity-php-swift.yml` (Go 1.22.x on ubuntu-latest).
