# Protocol Testing

Use the minimal headless server to exercise the protocol from any SDK:

```bash
npm run protocol:test-server -- --port=9877 --secret=dev-secret
```

Server behaviors:
- Accepts WebSocket connections, optional `--secret` gate (also checks `X-Bridge-Secret` header).
- Handles `auth` → replies `auth_success`.
- Handles `hello` → replies `hello_ack` (echoes `protocol`).
- Replies `pong` to `ping` and emits periodic `ping` to test heartbeat handling.
- Echoes unknown messages for debugging; replies success to `control_request`.

For SDK CI, start the server, run client conformance against the fixtures in `protocol/fixtures/`, and stop the server when done.
