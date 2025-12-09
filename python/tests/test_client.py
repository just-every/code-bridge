import asyncio
import os
import subprocess
import time
import socket
from pathlib import Path

import pytest

from code_bridge.client import CodeBridgeClient, BridgeConfig


DEFAULT_PORT = 9880


@pytest.fixture(scope="module")
def bridge_target():
  """Provide a ready bridge URL/secret, starting a local server only if needed."""
  env_url = os.environ.get("CODE_BRIDGE_URL")
  secret = os.environ.get("CODE_BRIDGE_SECRET", "dev-secret")
  if env_url:
    yield env_url, secret
    return

  port = int(os.environ.get("CODE_BRIDGE_PORT", DEFAULT_PORT))
  repo_root = Path(__file__).resolve().parents[2]
  server_script = repo_root / "tools" / "protocol-test-server.js"
  server = subprocess.Popen(
    ["node", str(server_script), f"--port={port}", f"--secret={secret}"],
    cwd=repo_root,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
  )
  deadline = time.time() + 5
  while time.time() < deadline:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
      if sock.connect_ex(("127.0.0.1", port)) == 0:
        break
    time.sleep(0.05)
  yield f"ws://localhost:{port}", secret
  server.terminate()
  server.wait()


@pytest.mark.asyncio
async def test_happy_path_console_event(bridge_target):
  url, secret = bridge_target
  cfg = BridgeConfig(url=url, secret=secret)
  client = CodeBridgeClient(cfg)
  await client.start()
  await asyncio.wait_for(client._connected.wait(), timeout=5)
  await client.send_console("pytest hello", level="info")
  await asyncio.sleep(0.1)
  await client.stop()


@pytest.mark.asyncio
async def test_reconnect_and_heartbeat(bridge_target):
  url, secret = bridge_target
  cfg = BridgeConfig(
    url=url,
    secret=secret,
    heartbeat_interval_ms=100,
    heartbeat_timeout_ms=200,
    backoff_initial_ms=50,
    backoff_max_ms=200,
  )
  client = CodeBridgeClient(cfg)
  await client.start()
  await asyncio.wait_for(client._connected.wait(), timeout=5)
  await asyncio.sleep(0.15)
  # Force close to trigger reconnect
  if client._ws:
    await client._ws.close()
  await asyncio.sleep(0.25)
  # Should have reconnected and be able to send
  await client.send_console("after reconnect")
  await client.stop()
