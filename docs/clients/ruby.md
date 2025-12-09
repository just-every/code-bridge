# Ruby Quickstart (skeleton)

## Install
Registry: `gem install code-bridge` (after publishing)
Dev: `cd ruby && bundle install`
One-liner dev: `npm run sdk:ruby`

## Configure
Set `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` in ENV; optionally gate with `RACK_ENV`/`RAILS_ENV` dev checks.

## Initialize
Create/start the client with `url`, `secret`, `projectId?`, and capabilities; begin heartbeat.

## Send First Event
Emit a console/log event; ensure the `hello` includes the shared `protocol` version.

## Verify
Run host or `npm run protocol:test-server`; watch for the received event.

## Next Steps
Integrate with Rails/Rack logging, add error capture, and register control handlers as needed.
