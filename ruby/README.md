# Ruby Code Bridge Client (minimal)

## One-liner
From repo root: `npm run sdk:ruby`

## API
- `start` → connects, auth + hello (protocol 2), starts simple heartbeat ping
- `send_console(message, level: 'info')`
- `send_error(message)`
- `stop`

Heartbeat: ping every 15s (no timeout handling yet).
