# Python Quickstart

Status: **Preview** (heartbeat 15s/timeout 30s, reconnect with 1s→30s backoff, buffered sends)

## Install
- Published (when released): `pip install code-bridge-client`
- Local dev from this repo:
  ```bash
  cd python
  pip install -r requirements.txt
  pip install .
  ```

## Run the example
```bash
# 1) Start the host once (writes .code/code-bridge.json)
npx code-bridge-host

# 2) Export connection details for any SDK
export CODE_BRIDGE_URL=$(node -p "require('./.code/code-bridge.json').url")
export CODE_BRIDGE_SECRET=$(node -p "require('./.code/code-bridge.json').secret")

# 3) Send a console + error event
python python/examples/basic_usage.py
```

## Embed in your app
```python
import asyncio, json
from code_bridge.client import CodeBridgeClient, BridgeConfig

meta = json.load(open('.code/code-bridge.json'))
cfg = BridgeConfig(url=meta['url'], secret=meta['secret'], project_id='api-service')
client = CodeBridgeClient(cfg)

async def run():
  await client.start()
  await client.send_console('hello from python', level='info')
  await client.send_error('sample error')
  await asyncio.sleep(0.2)
  await client.stop()

asyncio.run(run())
```

## API surface
- `await client.start()` / `await client.stop()` — opens the WebSocket and starts ping/pong heartbeats
- `send_console(message, level='info')`
- `send_error(message, stack=None)`
- Heartbeat: 15s ping / 30s timeout
- Reconnect: exponential backoff 1s → 30s
- Buffer: 200 events, drop-oldest when full

## Notes & limits
- Currently console + error only (no screenshots/control/network capture yet)
- Not published to PyPI yet; use local install until release
- Uses `CODE_BRIDGE_URL` / `CODE_BRIDGE_SECRET`; defaults to `ws://localhost:9877` and `dev-secret` if unset
