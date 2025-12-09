# Go Code Bridge Client (minimal)

## Install from module proxy
```
go install github.com/just-every/code-bridge/go/codebridge@latest
```

## Root one-liner
`npm run sdk:go`

## Run tests locally
```
node tools/protocol-test-server.js --port=9877 --secret=dev-secret &
CODE_BRIDGE_URL=ws://localhost:9877 CODE_BRIDGE_SECRET=dev-secret go test ./...
kill %1
```
