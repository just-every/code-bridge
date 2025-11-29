import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startBridge } from '../client';
import { detectPlatform as realDetectPlatform } from '../platform';

// Simple fake WebSocket to capture outbound messages
class FakeWebSocket {
  static sent: any[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (evt: { data: string }) => void;
  constructor(public url: string) {
    (globalThis as any).lastWebSocket = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(payload: string) {
    FakeWebSocket.sent.push(JSON.parse(payload));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

// Helpers to stub a browser-like environment
function setupBrowserEnv() {
  (globalThis as any).window = {
    location: { href: 'https://example.com/', pathname: '/' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    history: {
      pushState: vi.fn(function pushState(_s: any, _t: string, url?: string) {
        if (url) {
          (globalThis as any).window.location.pathname = url;
          (globalThis as any).window.location.href = `https://example.com${url}`;
          // trigger popstate/listeners manually if needed
          const evt = { type: 'popstate' } as any;
          (globalThis as any).window.dispatchEvent?.(evt);
        }
      }),
      replaceState: vi.fn(),
    },
    dispatchEvent: (_evt: any) => {},
  } as any;
  (globalThis as any).document = {} as any;
  // vitest jsdom defines navigator; remove to allow override
  try { delete (globalThis as any).navigator; } catch {}
  (globalThis as any).navigator = { userAgent: 'vitest' } as any;
  (globalThis as any).performance = { now: () => Date.now() } as any;
  (globalThis as any).WebSocket = FakeWebSocket as any;
  (globalThis as any).fetch = vi.fn(async (_url: string) => ({
    status: 200,
    headers: { get: (_k: string) => '0' },
  }));
  (globalThis as any).window.fetch = (globalThis as any).fetch;
}

function teardownBrowserEnv() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).performance;
  delete (globalThis as any).WebSocket;
  delete (globalThis as any).fetch;
  FakeWebSocket.sent = [];
  vi.restoreAllMocks();
}

describe('capture instrumentation', () => {
  beforeEach(() => {
    setupBrowserEnv();
  });

  afterEach(() => {
    teardownBrowserEnv();
  });

  it('captures console logs with full args', async () => {
    const bridge = startBridge({ enabled: true, throttleMs: 0, enableNetwork: false, enableNavigation: false });
    await new Promise((r) => setTimeout(r, 5));
    FakeWebSocket.sent = []; // drop auth/hello
    console.log('hello', { a: 1 });
    await new Promise((r) => setTimeout(r, 20));
    const payload = FakeWebSocket.sent.find((m) => m.type === 'console');
    expect(payload).toBeTruthy();
    expect(payload.message).toContain('hello');
    bridge.disconnect();
  });

  it('emits navigation events on pushState', async () => {
    const bridge = startBridge({ enabled: true, throttleMs: 0, enableNavigation: true });
    await new Promise((r) => setTimeout(r, 10));
    FakeWebSocket.sent = [];
    bridge.trackNavigation({ from: 'https://example.com/', to: 'https://example.com/next', route: '/next', initiator: 'pushState' });
    await new Promise((r) => setTimeout(r, 30));
    const payload = FakeWebSocket.sent.find((m) => m.type === 'navigation');
    expect(payload).toBeTruthy();
    expect(payload.route).toBe('/next');
    bridge.disconnect();
  });

  it('flags 4xx fetch responses as error-level network events', async () => {
    (globalThis as any).fetch = vi.fn(async (_url: string) => ({
      status: 404,
      headers: { get: (_k: string) => '0' },
    }));
    (globalThis as any).window.fetch = (globalThis as any).fetch;
    startBridge({ enabled: true, throttleMs: 0, enableNetwork: true });
    await new Promise((r) => setTimeout(r, 20));
    FakeWebSocket.sent = [];
    await (globalThis as any).window.fetch('https://example.com/notfound');
    await new Promise((r) => setTimeout(r, 80));
    const payload = FakeWebSocket.sent.find((m) => m.type === 'network');
    expect(payload).toBeTruthy();
    expect(payload.network.status).toBe(404);
    expect(payload.level).toBe('error');
  });

  it('sends screenshots when enabled', async () => {
    const bridge = startBridge({
      enabled: true,
      throttleMs: 0,
      enableScreenshot: true,
      screenshotProvider: async () => ({ mime: 'image/png', data: 'iVBORw0KGgo=' }),
    });
    await new Promise((r) => setTimeout(r, 5));
    FakeWebSocket.sent = [];
    bridge.sendScreenshot({ mime: 'image/png', data: 'abc' });
    await new Promise((r) => setTimeout(r, 20));
    const payload = FakeWebSocket.sent.find((m) => m.type === 'screenshot');
    expect(payload).toBeTruthy();
    expect(payload.mime).toBe('image/png');
    bridge.disconnect();
  });

  it('replies to control_request with control_result', async () => {
    const bridge = startBridge({ enabled: true, throttleMs: 0, enableControl: true });
    await new Promise((r) => setTimeout(r, 10));
    const wsInstance = (globalThis as any).lastWebSocket as FakeWebSocket | undefined;
    const req = { type: 'control_request', id: '123', action: 'eval', code: '1+2' };
    FakeWebSocket.sent = []; // clear hello/auth noise
    wsInstance?.onmessage?.({ data: JSON.stringify(req) });
    await new Promise((r) => setTimeout(r, 20));
    const response = FakeWebSocket.sent.find((m) => m.type === 'control_result' && m.id === '123');
    expect(response).toBeTruthy();
    expect(response.ok).toBe(true);
    bridge.disconnect();
  });
});
