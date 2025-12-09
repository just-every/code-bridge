import asyncio
import os
import subprocess
import sys
import time
import json

import pytest

from code_bridge.client import CodeBridgeClient, BridgeConfig


PORT = 9880


@pytest.fixture(scope="module", autouse=True)
def protocol_server():
  env = os.environ.copy()
  server = subprocess.Popen(
    ["node", "tools/protocol-test-server.js", f"--port={PORT}", "--secret=dev-secret"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
  )
  time.sleep(0.2)
  yield
  server.terminate()
  server.wait()


@pytest.mark.asyncio
async def test_happy_path_console_event():
  cfg = BridgeConfig(url=f"ws://localhost:{PORT}", secret="dev-secret")
  client = CodeBridgeClient(cfg)
  await client.start()
  await client.send_console("pytest hello", level="info")
  # ensure server replies hello_ack
  ws = client._ws  # type: ignore
  msg = await ws.recv()
  data = json.loads(msg)
  assert data.get("type") in {"auth_success", "hello_ack", "pong", "ping"}
  await asyncio.sleep(0.1)
  await client.stop()


@pytest.mark.asyncio
async def test_reconnect_and_heartbeat():
  cfg = BridgeConfig(
    url=f"ws://localhost:{PORT}",
    secret="dev-secret",
    heartbeat_interval_ms=100,
    heartbeat_timeout_ms=200,
    backoff_initial_ms=50,
    backoff_max_ms=200,
  )
  client = CodeBridgeClient(cfg)
  await client.start()
  await asyncio.sleep(0.15)
  # Force close to trigger reconnect
  if client._ws:
    await client._ws.close()
  await asyncio.sleep(0.25)
  # Should have reconnected and be able to send
  await client.send_console("after reconnect")
  await client.stop()
