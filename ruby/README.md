# Ruby Code Bridge Client

## One-liner
From repo root: `npm run sdk:ruby`

## Features
- Auth → waits for `auth_success` then sends `hello` (protocol v2)
- Heartbeat ping/pong (15s/30s defaults) with timeout-driven reconnect
- Reconnect with exponential backoff + jitter (1s→30s)
- Buffered sends (default 200, drop-oldest) with a single drop-count notice on flush
- Control requests: `on_control { |msg| ... }` replies with `control_result`

## API
- `start`
- `send_console(message, level: 'info')`
- `send_error(message)`
- `on_control { |msg| ... }`
- `stop`

## Tests
```
cd ruby && bundle exec ruby -Ilib tests/test_client.rb
```
Uses `tests/protocol_host.js` to validate handshake ordering, buffering/drop notice, control round-trip, and heartbeat reconnect. CI: Ruby parity runs in `.github/workflows/lang-parity-php-swift.yml` (Ruby 3.2).
