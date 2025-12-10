# Go Quickstart

Status: **Preview** (heartbeat 15s/30s, reconnect with 1s→30s backoff, no buffering)

## Install
- Published: `go install github.com/just-every/code-bridge/go/codebridge@latest`
- From repo: `cd go && go test ./...` (uses module path `github.com/just-every/code-bridge/go/codebridge`)

## Run the example
```bash
npx code-bridge-host
export CODE_BRIDGE_URL=$(node -p "require('./.code/code-bridge.json').url")
export CODE_BRIDGE_SECRET=$(node -p "require('./.code/code-bridge.json').secret")
go run go/examples/main.go
```

## Embed in your app
```go
import (
  "context"
  codebridge "github.com/just-every/code-bridge/go/codebridge"
)

cfg := codebridge.ClientConfig{URL: url, Secret: secret, Capabilities: []string{"console", "error"}}
client := codebridge.NewClient(cfg)
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

_ = client.Start(ctx)             // opens WS, sends auth + hello, starts ping/pong
_ = client.SendConsole("info", "hello from go")
// client.Close() when shutting down
```

## API surface
- `Start(ctx)` — connects, sends `auth` + `hello`, starts heartbeat & reconnect loop
- `Close()` — closes WS
- `SendConsole(level, message)` — console event
- Heartbeat: 15s ping / 30s timeout
- Reconnect: exponential backoff 1s → 30s
- Buffering: not implemented (send calls expect an open connection)

## Notes & limits
- Console + error events only; no screenshots/control/network capture yet
- Set `CODE_BRIDGE_URL` / `CODE_BRIDGE_SECRET`; defaults to `ws://localhost:9877` and `dev-secret` if env missing
