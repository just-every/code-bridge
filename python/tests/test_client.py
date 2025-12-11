import asyncio

import pytest
import pytest_asyncio

import code_bridge.client as client_module
from code_bridge.client import BridgeConfig, CodeBridgeClient, PROTOCOL_VERSION
from .protocol_host import ProtocolHost


pytestmark = pytest.mark.asyncio


async def wait_for_condition(predicate, timeout: float = 1.0):
  loop = asyncio.get_event_loop()
  deadline = loop.time() + timeout
  while True:
    if predicate():
      return
    remaining = deadline - loop.time()
    if remaining <= 0:
      raise asyncio.TimeoutError("condition not met")
    await asyncio.sleep(0.01)


@pytest_asyncio.fixture
async def host_factory():
  hosts = []

  async def factory(**kwargs):
    host = ProtocolHost(**kwargs)
    await host.start()
    hosts.append(host)
    return host

  yield factory

  for host in hosts:
    await host.stop()


async def test_auth_then_hello_waits_for_auth_success(host_factory):
  host = await host_factory(auto_auth_success=False, secret="handshake-secret")
  cfg = BridgeConfig(
    url=host.url,
    secret="handshake-secret",
    capabilities=["console", "control"],
    project_id="proj-123",
  )
  client = CodeBridgeClient(cfg)

  try:
    await client.start()

    auth = await host.wait_for(lambda msgs: next((m for m in msgs if m.get("type") == "auth"), None), timeout=1.0)
    assert auth["secret"] == "handshake-secret"

    with pytest.raises(asyncio.TimeoutError):
      await host.wait_for(lambda msgs: next((m for m in msgs if m.get("type") == "hello"), None), timeout=0.15)

    await host.send_auth_success()
    hello = await host.wait_for(lambda msgs: next((m for m in msgs if m.get("type") == "hello"), None), timeout=1.0)

    assert hello["protocol"] == PROTOCOL_VERSION
    assert "console" in hello["capabilities"]
    assert hello.get("platform") == "python"
    assert hello.get("projectId") == "proj-123"
  finally:
    await client.stop()


async def test_heartbeat_timeout_triggers_reconnect(host_factory):
  host = await host_factory(auto_pong=False)
  cfg = BridgeConfig(
    url=host.url,
    secret="dev-secret",
    heartbeat_interval_ms=30,
    heartbeat_timeout_ms=80,
    backoff_initial_ms=30,
    backoff_max_ms=80,
  )
  client = CodeBridgeClient(cfg)

  try:
    await client.start()
    await host.wait_for(lambda msgs: any(m.get("type") == "ping" for m in msgs), timeout=1.0)
    await host.wait_for_connections(2, timeout=2.0)
  finally:
    await client.stop()


async def test_reconnects_use_jittered_backoff(monkeypatch):
  attempt_times = []

  async def failing_connect(*args, **kwargs):
    attempt_times.append(asyncio.get_event_loop().time())
    raise OSError("boom")

  class StubRandom:
    def uniform(self, a, b):
      return (a + b) / 2

  monkeypatch.setattr(client_module.websockets, "connect", failing_connect)
  monkeypatch.setattr(client_module, "random", StubRandom())

  cfg = BridgeConfig(
    url="ws://127.0.0.1:9",
    secret="dev-secret",
    backoff_initial_ms=40,
    backoff_max_ms=160,
  )
  client = CodeBridgeClient(cfg)

  try:
    await client.start()
    await wait_for_condition(lambda: len(attempt_times) >= 3, timeout=1.5)
  finally:
    await client.stop()

  deltas = [attempt_times[i + 1] - attempt_times[i] for i in range(len(attempt_times) - 1)]
  expected = [0.05, 0.1]
  for delta, exp in zip(deltas, expected):
    assert delta == pytest.approx(exp, rel=0.3, abs=0.02)
  assert deltas[1] > deltas[0]


async def test_buffers_drop_oldest_and_emit_single_drop_notice(host_factory):
  host = await host_factory()
  cfg = BridgeConfig(
    url=host.url,
    secret="dev-secret",
    buffer_limit=3,
    backoff_initial_ms=20,
    backoff_max_ms=40,
  )
  client = CodeBridgeClient(cfg)

  try:
    for idx in range(5):
      await client.send_console(f"msg-{idx}")

    await client.start()
    await host.wait_for(lambda msgs: any(m.get("type") == "hello" for m in msgs), timeout=1.0)
    await host.wait_for(lambda msgs: sum(1 for m in msgs if m.get("type") == "console") >= 3, timeout=1.0)

    consoles = [m["message"] for m in host.messages if m.get("type") == "console"]
    assert consoles == ["msg-2", "msg-3", "msg-4"]

    drop_infos = [m for m in host.messages if m.get("type") == "info" and "drop count" in m.get("message", "")]
    assert len(drop_infos) == 1
    assert "drop count=2" in drop_infos[0]["message"]
  finally:
    await client.stop()


async def test_control_requests_receive_results(host_factory):
  host = await host_factory()
  cfg = BridgeConfig(
    url=host.url,
    secret="dev-secret",
    capabilities=["control"],
  )
  client = CodeBridgeClient(cfg)

  handled = []

  if not hasattr(client, "on_control"):
    pytest.fail("CodeBridgeClient should expose on_control(handler) for control plane")

  def handler(msg):
    handled.append(msg)
    if msg.get("action") == "echo":
      return {"echo": msg.get("args")}
    raise ValueError("boom")

  client.on_control(handler)

  try:
    await client.start()
    await host.wait_for(lambda msgs: any(m.get("type") == "hello" for m in msgs), timeout=1.0)

    await host.send_control_request(action="echo", id="ok-1", args={"value": 1})
    ok_result = await host.wait_for(lambda msgs: next((m for m in msgs if m.get("type") == "control_result" and m.get("id") == "ok-1"), None), timeout=1.0)

    await host.send_control_request(action="fail", id="err-1")
    err_result = await host.wait_for(lambda msgs: next((m for m in msgs if m.get("type") == "control_result" and m.get("id") == "err-1"), None), timeout=1.0)

    assert ok_result["ok"] is True
    assert ok_result.get("result") == {"echo": {"value": 1}}

    assert err_result["ok"] is False
    assert "boom" in err_result.get("error", {}).get("message", "")
    assert len(handled) == 2
  finally:
    await client.stop()
