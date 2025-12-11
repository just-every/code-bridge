# Java Code Bridge Client

## One-liner
From repo root: `npm run sdk:java`

## API
- `start()` — connects, sends `auth`, waits for `auth_success`, then sends `hello`; keeps running with heartbeat + reconnect.
- `sendConsole(level, message)`
- `sendError(message)`
- `onControl(handler)` — handle `control_request` and reply with `control_result`.
- `stop()` — stops loop and closes socket.

## Runtime behavior
- Heartbeat: ping every 15s (configurable) and reconnect if no pong within 30s.
- Reconnect: exponential backoff 1s→30s with jitter.
- Buffering: queues up to 200 events, drop-oldest, emits one `info` drop-count notice after flush.
- Control: handles `control_request` and responds with `control_result`.

## Testing
Requires JDK 11+, Maven, and Node (for the protocol host).

```bash
cd java
mvn test
```

Tests use `src/test/resources/ProtocolHost.js` to validate handshake ordering, heartbeat timeout/reconnect, buffering drop notice, and control round-trip. CI is recommended (multi-JDK) but not yet wired here.
Tests use `src/test/resources/ProtocolHost.js` to validate handshake ordering, heartbeat timeout/reconnect, buffering drop notice, and control round-trip. CI runs in `.github/workflows/lang-parity-php-swift.yml` (Temurin 17); consider expanding to a multi-JDK matrix later.
