# PHP Code Bridge Client (minimal)

## One-liner
From repo root: `npm run sdk:php`

## API
- `Client::start()` → connects, sends auth + hello (protocol 2)
- `sendConsole(message, level='info')`
- `sendError(message)`
- `stop()`

Heartbeat: not implemented (keep connections short for now).
