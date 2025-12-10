# Ruby Quickstart

Status: **Experimental** (ping heartbeat only; no reconnect/backoff yet)

## Install
- Published (after release): `gem install code-bridge`
- From repo for dev/testing:
  ```bash
  cd ruby
  bundle install
  ```

## Run the example
```bash
npx code-bridge-host
export CODE_BRIDGE_URL=$(node -p "require('./.code/code-bridge.json').url")
export CODE_BRIDGE_SECRET=$(node -p "require('./.code/code-bridge.json').secret")
bundle exec ruby ruby/examples/basic.rb
```

## Embed in your app
```ruby
require 'code_bridge_client'

client = CodeBridge::Client.new(
  url: ENV.fetch('CODE_BRIDGE_URL'),
  secret: ENV.fetch('CODE_BRIDGE_SECRET'),
  project_id: 'ruby-app',
  capabilities: ['console', 'error']
)

client.start
client.send_console('hello from ruby')
client.send_error('sample error')
client.stop
```

## API surface
- `start` / `stop`
- `send_console(message, level: 'info')`
- `send_error(message)`
- Heartbeat: 15s ping loop
- Reconnect/backoff: **not implemented yet**
- Buffering: none (messages are dropped if socket is closed)

## Notes & limits
- Console + error events only
- Uses `CODE_BRIDGE_URL` / `CODE_BRIDGE_SECRET`; defaults to `ws://localhost:9877` and `dev-secret` when env missing
