"""Minimal Python client for Code Bridge protocol v2.

Implements auth + hello handshake, heartbeat ping/pong, and helpers for
sending console/error events. Intended for dev/testing parity with the JS
client; keep surface aligned with docs/client-api-spec.md.
"""

import asyncio
import contextlib
import json
import os
from dataclasses import dataclass, field
from typing import Callable, List, Optional

import websockets


PROTOCOL_VERSION = 2
HEARTBEAT_INTERVAL_MS = 15_000
HEARTBEAT_TIMEOUT_MS = 30_000
BACKOFF_INITIAL_MS = 1_000
BACKOFF_MAX_MS = 30_000
BUCKET_LIMIT = 200


def _now_ms() -> int:
  return int(asyncio.get_event_loop().time() * 1000)


@dataclass
class BridgeConfig:
  url: str
  secret: str
  project_id: Optional[str] = None
  capabilities: List[str] = field(default_factory=lambda: ["console", "error"])
  heartbeat_interval_ms: int = HEARTBEAT_INTERVAL_MS
  heartbeat_timeout_ms: int = HEARTBEAT_TIMEOUT_MS
  buffer_limit: int = BUCKET_LIMIT
  backoff_initial_ms: int = BACKOFF_INITIAL_MS
  backoff_max_ms: int = BACKOFF_MAX_MS
  logger: Optional[Callable[[str], None]] = None


class CodeBridgeClient:
  def __init__(self, config: BridgeConfig):
    self.config = config
    self._ws: Optional[websockets.WebSocketClientProtocol] = None
    self._heartbeat_task: Optional[asyncio.Task] = None
    self._recv_task: Optional[asyncio.Task] = None
    self._pong_deadline: Optional[float] = None
    self._buffer: List[dict] = []
    self._connected = asyncio.Event()
    self._run_task: Optional[asyncio.Task] = None
    self._stopped = asyncio.Event()

  async def start(self):
    if self._run_task and not self._run_task.done():
      return
    self._stopped.clear()
    self._run_task = asyncio.create_task(self._run_loop())

  async def stop(self):
    self._stopped.set()
    tasks = [self._heartbeat_task, self._recv_task, self._run_task]
    for t in tasks:
      if t:
        t.cancel()
    if self._ws:
      await self._ws.close()
      self._ws = None
    self._connected.clear()

  async def send_console(self, message: str, level: str = "info"):
    await self._send_event({"type": "console", "level": level, "message": message, "timestamp": _now_ms()})

  async def send_error(self, message: str, stack: Optional[str] = None):
    payload = {"type": "error", "message": message, "timestamp": _now_ms()}
    if stack:
      payload["stack"] = stack
    await self._send_event(payload)

  # Internal helpers
  async def _send_event(self, event: dict):
    if len(self._buffer) >= self.config.buffer_limit:
      self._buffer.pop(0)
    self._buffer.append(event)
    await self._flush_buffer()

  async def _flush_buffer(self):
    if self._is_ws_closed():
      return
    while self._buffer:
      ev = self._buffer.pop(0)
      await self._ws.send(json.dumps(ev))

  async def _send(self, obj: dict):
    if not self._ws:
      raise RuntimeError("WebSocket not connected")
    await self._ws.send(json.dumps(obj))

  async def _heartbeat_loop(self):
    try:
      while True:
        if self._is_ws_closed():
          return
        await self._ws.send(json.dumps({"type": "ping"}))
        await asyncio.sleep(self.config.heartbeat_interval_ms / 1000)
    except asyncio.TimeoutError:
      self._log("heartbeat timeout; closing")
      if self._ws:
        await self._ws.close()
    except asyncio.CancelledError:
      pass

  def _log(self, msg: str):
    if self.config.logger:
      self.config.logger(msg)

  def _is_ws_closed(self) -> bool:
    if not self._ws:
      return True
    closed = getattr(self._ws, "closed", None)
    if closed is not None:
      return bool(closed)
    state = getattr(self._ws, "state", None)
    try:
      from websockets.protocol import State  # type: ignore
      if state in (State.CLOSING, State.CLOSED):
        return True
    except Exception:
      if state in ("CLOSING", "CLOSED"):
        return True
    return False

  async def _run_loop(self):
    delay = self.config.backoff_initial_ms / 1000
    while not self._stopped.is_set():
      try:
        self._log(f"connecting to {self.config.url}")
        headers = {"X-Bridge-Secret": self.config.secret}
        try:
          self._ws = await websockets.connect(self.config.url, extra_headers=headers)
        except TypeError:
          # websockets>=15 renamed extra_headers->additional_headers
          self._ws = await websockets.connect(self.config.url, additional_headers=headers)
        await self._send({"type": "auth", "secret": self.config.secret, "role": "bridge"})
        await self._send({
          "type": "hello",
          "capabilities": self.config.capabilities,
          "platform": "python",
          "projectId": self.config.project_id,
          "protocol": PROTOCOL_VERSION,
        })
        self._log("connected")
        self._connected.set()
        delay = self.config.backoff_initial_ms / 1000
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        self._recv_task = asyncio.create_task(self._drain_loop())
        done, pending = await asyncio.wait(
          [self._heartbeat_task, self._recv_task],
          return_when=asyncio.FIRST_EXCEPTION,
        )
        for task in done:
          if task.exception():
            self._log(f"task exception: {task.exception()}")
            raise task.exception()
        for task in pending:
          task.cancel()
      except Exception as e:
        self._log(f"connection failed: {e}")
      finally:
        self._connected.clear()
        if self._ws:
          with contextlib.suppress(Exception):
            await self._ws.close()
          self._log(f"closed: code={getattr(self._ws, 'close_code', None)} reason={getattr(self._ws, 'close_reason', None)}")
        self._ws = None
        if self._heartbeat_task:
          self._heartbeat_task.cancel()
        if self._recv_task:
          self._recv_task.cancel()
      if self._stopped.is_set():
        break
      await asyncio.sleep(delay)
      delay = min(delay * 2, self.config.backoff_max_ms / 1000)

  async def _drain_loop(self):
    while not self._stopped.is_set():
      if self._is_ws_closed():
        return
      try:
        msg = await self._ws.recv()
      except Exception:
        return
      try:
        data = json.loads(msg)
      except Exception:
        continue
      if data.get("type") == "ping":
        await self._ws.send(json.dumps({"type": "pong"}))
      if data.get("type") == "pong":
        # heartbeat loop handles timeout reset
        continue


def from_env() -> BridgeConfig:
  url = os.environ.get("CODE_BRIDGE_URL", "ws://localhost:9877")
  secret = os.environ.get("CODE_BRIDGE_SECRET", "dev-secret")
  return BridgeConfig(url=url, secret=secret)
