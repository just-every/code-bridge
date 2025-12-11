"""Minimal protocol host for Python SDK tests.

Spins up an in-process WebSocket server that behaves like the Code Bridge
host for the parts we need in tests: auth/hello, pings/pongs, and optional
control requests. It keeps state (messages, headers, connect times) so tests
can assert ordering without hitting the real Node harness.
"""

import asyncio
import contextlib
import json
from typing import Any, Callable, Dict, List, Optional

import websockets


class ProtocolHost:
  def __init__(
    self,
    *,
    secret: str = "dev-secret",
    auto_auth_success: bool = True,
    auto_hello_ack: bool = True,
    auto_pong: bool = True,
    ping_interval_ms: Optional[int] = None,
  ):
    self.secret = secret
    self.auto_auth_success = auto_auth_success
    self.auto_hello_ack = auto_hello_ack
    self.auto_pong = auto_pong
    self.ping_interval_ms = ping_interval_ms

    self._server: Optional[websockets.server.Serve] = None
    self._clients: set[Any] = set()
    self._last_ws: Optional[Any] = None
    self._loop = asyncio.get_event_loop()
    self._ping_tasks: Dict[Any, asyncio.Task] = {}

    self.messages: List[dict] = []  # inbound frames from client
    self.connection_times: List[float] = []
    self.disconnect_times: List[float] = []

  @property
  def url(self) -> str:
    if not self._server or not self._server.sockets:
      raise RuntimeError("ProtocolHost not started")
    port = self._server.sockets[0].getsockname()[1]
    return f"ws://127.0.0.1:{port}"

  async def start(self):
    self._server = await websockets.serve(self._handler, "127.0.0.1", 0)

  async def stop(self):
    for task in list(self._ping_tasks.values()):
      task.cancel()
      with contextlib.suppress(asyncio.CancelledError):
        await task
    self._ping_tasks.clear()
    for ws in list(self._clients):
      with contextlib.suppress(Exception):
        await ws.close()
    self._clients.clear()
    if self._server:
      self._server.close()
      await self._server.wait_closed()
    self._server = None

  async def _handler(self, websocket, _path=None):
    self._clients.add(websocket)
    self._last_ws = websocket
    self.connection_times.append(self._loop.time())

    ping_task = None
    if self.ping_interval_ms:
      ping_task = asyncio.create_task(self._ping_loop(websocket))
      self._ping_tasks[websocket] = ping_task

    try:
      async for raw in websocket:
        try:
          msg = json.loads(raw)
        except Exception:
          continue
        self.messages.append(msg)
        await self._handle_message(websocket, msg)
    except websockets.ConnectionClosed:
      pass
    finally:
      if ping_task:
        ping_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
          await ping_task
        self._ping_tasks.pop(websocket, None)
      self._clients.discard(websocket)
      self.disconnect_times.append(self._loop.time())

  async def _ping_loop(self, websocket):
    try:
      while True:
        await asyncio.sleep(self.ping_interval_ms / 1000)
        if websocket.closed:
          return
        await websocket.send(json.dumps({"type": "ping"}))
    except asyncio.CancelledError:
      return

  async def _handle_message(self, websocket, msg: dict):
    msg_type = msg.get("type")
    if msg_type == "auth":
      if self.secret and msg.get("secret") != self.secret:
        await websocket.close(code=4001, reason="invalid auth")
        return
      if self.auto_auth_success:
        await websocket.send(json.dumps({
          "type": "auth_success",
          "role": msg.get("role", "bridge"),
          "clientId": msg.get("clientId", "client"),
        }))
    elif msg_type == "hello":
      if self.auto_hello_ack:
        await websocket.send(json.dumps({"type": "hello_ack", "protocol": msg.get("protocol")}))
    elif msg_type == "ping":
      if self.auto_pong:
        await websocket.send(json.dumps({"type": "pong"}))

  async def send_auth_success(self):
    ws = next(iter(self._clients), None) or self._last_ws
    if not ws:
      deadline = self._loop.time() + 1.0
      while not ws and self._loop.time() < deadline:
        await asyncio.sleep(0.01)
        ws = next(iter(self._clients), None) or self._last_ws
    if not ws:
      raise RuntimeError("no active client to ack")
    await ws.send(json.dumps({"type": "auth_success", "role": "bridge", "clientId": "client"}))

  async def send_control_request(self, *, action: str, id: str = "req-1", args: Optional[dict] = None):
    ws = next(iter(self._clients), None)
    if not ws:
      raise RuntimeError("no active client")
    payload = {"type": "control_request", "id": id, "action": action}
    if args is not None:
      payload["args"] = args
    await ws.send(json.dumps(payload))

  async def close_active(self):
    ws = next(iter(self._clients), None)
    if ws:
      await ws.close()

  async def wait_for(self, predicate: Callable[[List[dict]], Any], timeout: float = 1.0):
    deadline = self._loop.time() + timeout
    while True:
      result = predicate(self.messages)
      if result:
        return result
      remaining = deadline - self._loop.time()
      if remaining <= 0:
        raise asyncio.TimeoutError("condition not met")
      await asyncio.sleep(0.01)

  async def wait_for_connections(self, count: int, timeout: float = 1.0):
    deadline = self._loop.time() + timeout
    while len(self.connection_times) < count:
      remaining = deadline - self._loop.time()
      if remaining <= 0:
        raise asyncio.TimeoutError("connection count not reached")
      await asyncio.sleep(0.01)
