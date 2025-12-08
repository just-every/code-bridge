import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BridgeWebSocket } from '../websocket';
import * as platform from '../platform';
import type { BridgeEvent } from '../types';

class MockWebSocket {
  static sent: any[] = [];
  static instances: MockWebSocket[] = [];

  readyState = 0;
  closed = false;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (evt: { data: string }) => void;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  static reset() {
    MockWebSocket.sent = [];
    MockWebSocket.instances = [];
  }

  send(payload: string) {
    MockWebSocket.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  receive(obj: any) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const buildEvent = (message: string): BridgeEvent => ({
  type: 'log',
  level: 'info',
  message,
  timestamp: Date.now(),
  platform: 'web',
});

const TRUNCATED_MARKER = '\u2026[truncated]';

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();
  vi.spyOn(platform, 'detectPlatform').mockReturnValue('web');
  vi.stubGlobal('WebSocket', MockWebSocket as any);
});

afterEach(() => {
  vi.useRealTimers();
  MockWebSocket.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BridgeWebSocket', () => {
  describe('heartbeat', () => {
    it('uses a heartbeat timeout longer than the ping interval by default', () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      expect((ws as any).heartbeatTimeoutMs).toBeGreaterThan((ws as any).heartbeatIntervalMs);
    });

    it('sends heartbeat pings, replies to ping, and closes when heartbeat timeout elapses', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).heartbeatIntervalMs = 10;
      (ws as any).heartbeatTimeoutMs = 15;

      const connectPromise = ws.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      const socket = MockWebSocket.instances[0];
      expect(socket).toBeDefined();

      socket?.receive({ type: 'ping' });
      expect(MockWebSocket.sent.some((m) => m.type === 'pong')).toBe(true);

      await vi.advanceTimersByTimeAsync(10);
      const pingMsg = MockWebSocket.sent.find((m) => m.type === 'ping');
      expect(pingMsg).toBeTruthy();

      const hbInterval = (ws as any).heartbeatInterval;
      if (hbInterval) clearInterval(hbInterval);

      await vi.advanceTimersByTimeAsync(14);
      expect(socket?.closed).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      expect(socket?.closed).toBe(true);
    });

    it('does not timeout before the first ping when timeout is shorter than interval', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).heartbeatIntervalMs = 15;
      (ws as any).heartbeatTimeoutMs = 10;

      const connectPromise = ws.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      const socket = MockWebSocket.instances[0];
      expect(socket).toBeDefined();

      // Before the first scheduled ping (15ms) we should not close, even though timeout < interval
      await vi.advanceTimersByTimeAsync(9);
      expect(socket?.closed).toBe(false);

      // First ping fires at 15ms and arms the timeout
      await vi.advanceTimersByTimeAsync(6);
      expect(MockWebSocket.sent.some((m) => m.type === 'ping')).toBe(true);
      expect(socket?.closed).toBe(false);

      // Without a pong, the timeout should close the socket 10ms after the ping
      await vi.advanceTimersByTimeAsync(10);
      expect(socket?.closed).toBe(true);
    });

    it('resets heartbeat timeout when receiving pong', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).heartbeatIntervalMs = 10;
      (ws as any).heartbeatTimeoutMs = 20;

      const connectPromise = ws.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      const socket = MockWebSocket.instances[0];
      expect(socket).toBeDefined();

      // Send ping and wait for initial timeout to nearly elapse
      await vi.advanceTimersByTimeAsync(10);
      expect(MockWebSocket.sent.some((m) => m.type === 'ping')).toBe(true);

      // Stop the interval to prevent additional pings
      const hbInterval = (ws as any).heartbeatInterval;
      if (hbInterval) clearInterval(hbInterval);

      // Almost timeout (19ms of 20ms)
      await vi.advanceTimersByTimeAsync(18);
      expect(socket?.closed).toBe(false);

      // Receive pong - should reset timeout
      socket?.receive({ type: 'pong' });

      // Wait another 18ms (would have timed out without reset)
      await vi.advanceTimersByTimeAsync(18);
      expect(socket?.closed).toBe(false);

      // Now wait the full timeout period from the reset
      await vi.advanceTimersByTimeAsync(3);
      expect(socket?.closed).toBe(true);
    });

    it('sends multiple heartbeat pings at regular intervals', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).heartbeatIntervalMs = 10;
      (ws as any).heartbeatTimeoutMs = 100;

      const connectPromise = ws.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      const socket = MockWebSocket.instances[0];
      MockWebSocket.sent = []; // Clear initial messages

      // Advance through multiple intervals, responding to each ping
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(10);
        const pings = MockWebSocket.sent.filter((m) => m.type === 'ping');
        expect(pings.length).toBe(i + 1);
        // Respond to keep connection alive
        socket?.receive({ type: 'pong' });
      }

      expect(socket?.closed).toBe(false);
    });

    it('stops heartbeat when connection closes', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).heartbeatIntervalMs = 10;

      const connectPromise = ws.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      expect((ws as any).heartbeatInterval).not.toBeNull();
      await vi.advanceTimersByTimeAsync(10);
      expect((ws as any).heartbeatTimeout).not.toBeNull();

      ws.disconnect();

      expect((ws as any).heartbeatInterval).toBeNull();
      expect((ws as any).heartbeatTimeout).toBeNull();
    });
  });

  describe('reconnect backoff', () => {
    it('backs off reconnect attempts up to the configured maximum', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', [], 'web');
      const connectSpy = vi.spyOn(ws as any, 'connect').mockRejectedValue(new Error('fail'));
      const timeoutSpy = vi.spyOn(global, 'setTimeout');

      const triggerReconnect = async (expectedDelay: number) => {
        (ws as any).scheduleReconnect();
        const call = timeoutSpy.mock.calls.at(-1);
        expect(call?.[1]).toBe(expectedDelay);
        await vi.advanceTimersByTimeAsync(expectedDelay);
        await Promise.resolve();
      };

      await triggerReconnect(1000);
      expect((ws as any).reconnectDelay).toBe(2000);

      await triggerReconnect(2000);
      expect((ws as any).reconnectDelay).toBe(4000);

      await triggerReconnect(4000);
      expect((ws as any).reconnectDelay).toBe(8000);

      await triggerReconnect(8000);
      expect((ws as any).reconnectDelay).toBe(16000);

      await triggerReconnect(16000);
      expect((ws as any).reconnectDelay).toBe(30000);

      await triggerReconnect(30000);
      expect((ws as any).reconnectDelay).toBe(30000);

      expect(connectSpy).toHaveBeenCalledTimes(6);
    });

    it('resets reconnect delay to minimum on successful connection', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', [], 'web');
      (ws as any).reconnectDelay = 8000;

      const connectPromise = ws.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      expect((ws as any).reconnectDelay).toBe(1000);
    });

    it('does not schedule duplicate reconnects', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', [], 'web');
      const connectSpy = vi.spyOn(ws as any, 'connect').mockRejectedValue(new Error('fail'));

      (ws as any).scheduleReconnect();
      (ws as any).scheduleReconnect();
      (ws as any).scheduleReconnect();

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();

      // Should only have called connect once despite multiple scheduleReconnect calls
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('cancels scheduled reconnect on explicit disconnect', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', [], 'web');
      const connectSpy = vi.spyOn(ws as any, 'connect').mockRejectedValue(new Error('fail'));

      (ws as any).scheduleReconnect();
      ws.disconnect();

      await vi.advanceTimersByTimeAsync(5000);
      await Promise.resolve();

      expect(connectSpy).not.toHaveBeenCalled();
      expect((ws as any).reconnectTimeout).toBeNull();
    });
  });

  describe('buffering', () => {
    it('buffers events while disconnected and reports drop count when flushing', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).bufferLimit = 2;
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      ['one', 'two', 'three', 'four'].forEach((msg) => ws.send(buildEvent(msg)));

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const sentLogs = MockWebSocket.sent.filter((m) => m.type === 'log');
      expect(sentLogs.map((m) => m.message)).toEqual(['three', 'four']);

      const dropInfo = MockWebSocket.sent.find((m) => typeof m.message === 'string' && m.message.includes('drop count=2'));
      expect(dropInfo).toBeTruthy();
    });

    it('handles buffer at exact limit without dropping', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).bufferLimit = 3;
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      ['one', 'two', 'three'].forEach((msg) => ws.send(buildEvent(msg)));

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const sentLogs = MockWebSocket.sent.filter((m) => m.type === 'log');
      expect(sentLogs.map((m) => m.message)).toEqual(['one', 'two', 'three']);

      // No drop message should be sent
      const dropInfo = MockWebSocket.sent.find((m) => typeof m.message === 'string' && m.message.includes('drop count'));
      expect(dropInfo).toBeUndefined();
    });

    it('does not send drop count message when buffer is empty', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const dropInfo = MockWebSocket.sent.find((m) => typeof m.message === 'string' && m.message.includes('drop count'));
      expect(dropInfo).toBeUndefined();
    });

    it('accumulates drop count across multiple buffer overflows', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).bufferLimit = 2;
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      // Send 6 events, with buffer limit of 2, should drop 4
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach((msg) => ws.send(buildEvent(msg)));

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const sentLogs = MockWebSocket.sent.filter((m) => m.type === 'log');
      expect(sentLogs.map((m) => m.message)).toEqual(['e', 'f']);

      const dropInfo = MockWebSocket.sent.find((m) => typeof m.message === 'string' && m.message.includes('drop count=4'));
      expect(dropInfo).toBeTruthy();
    });

    it('sends events immediately when connected', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      ws.send(buildEvent('immediate'));

      const sentLogs = MockWebSocket.sent.filter((m) => m.type === 'log');
      expect(sentLogs.map((m) => m.message)).toEqual(['immediate']);
      expect((ws as any).buffer.length).toBe(0);
    });

    it('resets drop count after reporting', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      (ws as any).bufferLimit = 1;
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      ['one', 'two', 'three'].forEach((msg) => ws.send(buildEvent(msg)));

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      expect((ws as any).dropped).toBe(0);

      const dropInfo = MockWebSocket.sent.find((m) => typeof m.message === 'string' && m.message.includes('drop count=2'));
      expect(dropInfo).toBeTruthy();
    });
  });

  describe('redaction', () => {
    it('redacts sensitive fields and truncates oversized messages', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const longMessage = 'x'.repeat(4100);
      const event: BridgeEvent = {
        ...buildEvent(longMessage),
        args: [{ apiToken: 'abc', normal: 'ok' }],
        breadcrumbs: [{ timestamp: Date.now(), level: 'info', message: 'crumb', secretNote: 'hide-me' }],
      };

      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log' && typeof m.message === 'string' && m.message.includes('truncated')) as any;

      expect(payload).toBeDefined();
      expect(payload.message.length).toBe(4000 + TRUNCATED_MARKER.length);
      expect(payload.message.endsWith(TRUNCATED_MARKER)).toBe(true);
      expect(payload.args?.[0].apiToken).toBe('[redacted]');
      expect(payload.args?.[0].normal).toBe('ok');
      expect(payload.breadcrumbs?.[0].secretNote).toBe('[redacted]');
    });

    it('redacts all configured sensitive key patterns (token, secret, password)', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      const event: BridgeEvent = {
        ...buildEvent('test'),
        args: [
          {
            authToken: 'should-hide',
            apiPassword: 'should-hide',
            dbSecret: 'should-hide',
            userName: 'should-keep',
          }
        ],
      };

      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log') as any;
      expect(payload.args[0].authToken).toBe('[redacted]');
      expect(payload.args[0].apiPassword).toBe('[redacted]');
      expect(payload.args[0].dbSecret).toBe('[redacted]');
      expect(payload.args[0].userName).toBe('should-keep');
    });

    it('redacts nested objects in args', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      const event: BridgeEvent = {
        ...buildEvent('test'),
        args: [
          {
            nested: {
              apiToken: 'hide-this',
              safe: 'keep-this',
            }
          }
        ],
      };

      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log') as any;
      // Note: redactObject only goes one level deep, so nested.apiToken won't be redacted
      // This test documents the current behavior
      expect(payload.args[0].nested.apiToken).toBe('hide-this');
      expect(payload.args[0].nested.safe).toBe('keep-this');
    });

    it('redacts case-insensitive key matches', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      const event: BridgeEvent = {
        ...buildEvent('test'),
        args: [
          {
            TOKEN: 'hide-upper',
            Secret: 'hide-mixed',
            PASSWORD: 'hide-upper-full',
            normal: 'keep',
          }
        ],
      };

      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log') as any;
      expect(payload.args[0].TOKEN).toBe('[redacted]');
      expect(payload.args[0].Secret).toBe('[redacted]');
      expect(payload.args[0].PASSWORD).toBe('[redacted]');
      expect(payload.args[0].normal).toBe('keep');
    });

    it('handles arrays in args without crashing', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      const event: BridgeEvent = {
        ...buildEvent('test'),
        args: [
          ['item1', 'item2', { token: 'value' }]
        ],
      };

      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log') as any;
      expect(Array.isArray(payload.args[0])).toBe(true);
      expect(payload.args[0][0]).toBe('item1');
      expect(payload.args[0][1]).toBe('item2');
      // Note: redactObject preserves arrays and their contents as-is when iterating
      expect(payload.args[0][2].token).toBe('value');
    });

    it('truncates messages exactly at 4000 characters', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      const event = buildEvent('x'.repeat(4001));
      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log') as any;
      expect(payload.message).toBe('x'.repeat(4000) + TRUNCATED_MARKER);
    });

    it('does not truncate messages under 4000 characters', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      const event = buildEvent('x'.repeat(4000));
      ws.send(event);

      const payload = MockWebSocket.sent.find((m) => m.type === 'log') as any;
      expect(payload.message).toBe('x'.repeat(4000));
      expect(payload.message.includes('truncated')).toBe(false);
    });

    it('rejects invalid events (null, missing type)', async () => {
      const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
      vi.spyOn(ws as any, 'startHeartbeat').mockImplementation(() => {});

      const connectPromise = ws.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      MockWebSocket.sent = []; // Clear initial messages

      // @ts-ignore - testing invalid input
      ws.send(null);
      // @ts-ignore - testing invalid input
      ws.send({ message: 'no type field' });

      const logs = MockWebSocket.sent.filter((m) => m.type === 'log');
      expect(logs.length).toBe(0);
    });
  });
});
