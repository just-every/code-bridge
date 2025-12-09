# Go Quickstart (skeleton)

## Install
Registry: `go install github.com/just-every/code-bridge/go/codebridge@latest`
One-liner dev: `npm run sdk:go`

## Configure
Set `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` in env; pass into options.

## Initialize
Create/start the client with context; send `auth` and `hello` (with `protocol` version) once connected.

## Send First Event
Send a console/log event; client should handle heartbeat/reconnect.

## Verify
Run host or `npm run protocol:test-server`; check logs for the received event.

## Next Steps
Integrate with HTTP middleware/logging, add control handlers, and manage shutdown via context cancellation.
