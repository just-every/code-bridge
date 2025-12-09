# Python Quickstart (skeleton)

## Install
Registry: `pip install code-bridge-client` (after publishing)
Dev: `pip install -r python/requirements.txt`
One-liner dev: `npm run sdk:python`

## Configure
Set `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` via env or `.env`; optionally set `CODE_BRIDGE` to force-enable.

## Initialize
Create/start the client with `url`, `secret`, `projectId?`, `capabilities`, using async or sync wrapper.

## Send First Event
Send a console/log or pageview event; include `protocol` version in `hello`.

## Verify
Run host or `npm run protocol:test-server` and observe the received frame.

## Next Steps
Hook into logging/exception handlers, add control handlers, and enable network capture where supported.
