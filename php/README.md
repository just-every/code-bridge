# PHP Code Bridge Client

## One-liner
From repo root: `npm run sdk:php`

## API
- `Client::start()` → blocking loop that connects, performs `auth` then waits for `auth_success` before sending `hello` (protocol 2), then runs heartbeat/reconnect.
- `sendConsole(message, level='info')`
- `sendError(message)`
- `onControl(callable $handler)` → handle `control_request` and automatically reply with `control_result`.
- `stop()` → stops loop and closes the socket.

## Runtime behavior
- Heartbeat: ping every 15s (configurable) and reconnect if no pong within 30s.
- Reconnect: exponential backoff 1s→30s with jitter.
- Buffering: queues up to 200 events, drops oldest, and emits a single `info` message with the drop count after reconnect.
- Control: processes `control_request` and responds with `control_result {ok|error}`.

## Testing
`phpunit` (requires PHP 8+). Tests use `php/tests/ProtocolHost.js`; run from `php/` with `vendor/bin/phpunit`.
CI: PHPUnit runs on ubuntu-latest (PHP 8.2) via `.github/workflows/lang-parity-php-swift.yml`. Local macOS runs require a PHP 8+ toolchain.
