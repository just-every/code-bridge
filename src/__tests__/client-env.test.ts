import { describe, it, expect, vi, afterEach } from 'vitest';

import { startBridge } from '../client';
import * as platform from '../platform';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as any).__DEV__;
});

function stubWindow() {
  vi.stubGlobal(
    'window',
    {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { href: 'http://localhost/', pathname: '/' },
    } as any
  );
}

describe('startBridge environment safety', () => {
  it('no-ops safely in browser-like globals without process', () => {
    vi.spyOn(platform, 'isDevMode').mockReturnValue(false);
    vi.stubGlobal('process', undefined as any);
    stubWindow();
    vi.stubGlobal('document', {} as any);
    vi.stubGlobal('navigator', { userAgent: 'test' } as any);
    (globalThis as any).__DEV__ = false;

    const conn = startBridge();

    expect(conn).toHaveProperty('disconnect');
    expect(() => conn.disconnect()).not.toThrow();
  });

  it('does not spawn host when NODE_ENV=production in Node', () => {
    vi.spyOn(platform, 'isDevMode').mockReturnValue(false);
    vi.stubGlobal('process', {
      env: { NODE_ENV: 'production' },
      versions: { node: '20.x' },
      cwd: () => '/tmp',
      kill: () => {},
    } as any);
    stubWindow();

    const spawnSpy = vi.spyOn(require('child_process'), 'spawn').mockReturnValue({ unref() {} } as any);

    const conn = startBridge({ url: 'ws://localhost:9999', secret: 's' });
    expect(() => conn.disconnect()).not.toThrow();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('skips host ensure and still no-ops in web dev with __DEV__ flag', async () => {
    vi.spyOn(platform, 'isDevMode').mockReturnValue(true);
    vi.stubGlobal('process', undefined as any);
    stubWindow();
    vi.stubGlobal('document', {} as any);
    vi.stubGlobal('navigator', { userAgent: 'test' } as any);
    (globalThis as any).__DEV__ = true;

    class MockWS {
      readyState = 1;
      onopen?: () => void;
      onclose?: () => void;
      constructor(public url: string) {
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send() {}
      close() {
        this.readyState = 3;
        this.onclose && this.onclose();
      }
    }
    vi.stubGlobal('WebSocket', MockWS as any);

    const spawnSpy = vi.spyOn(require('child_process'), 'spawn').mockReturnValue({ unref() {} } as any);

    const conn = startBridge({ url: 'ws://localhost:9999', secret: 's', enabled: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(() => conn.disconnect()).not.toThrow();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('exposes navigation helper and restores fetch when network capture enabled in web', async () => {
    vi.spyOn(platform, 'isDevMode').mockReturnValue(true);
    vi.stubGlobal('process', undefined as any);
    stubWindow();
    vi.stubGlobal('document', {} as any);
    vi.stubGlobal('navigator', { userAgent: 'test' } as any);
    (globalThis as any).__DEV__ = true;

    const originalFetch = vi.fn(async () => ({ status: 200, headers: { get: () => null } })) as any;

    class MockWS {
      readyState = 1;
      onopen?: () => void;
      onclose?: () => void;
      constructor(public url: string) {
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send() {}
      close() {
        this.readyState = 3;
        this.onclose && this.onclose();
      }
    }

    vi.stubGlobal('WebSocket', MockWS as any);
    vi.stubGlobal('fetch', originalFetch);

    const conn = startBridge({ url: 'ws://localhost:9999', secret: 's', enabled: true, enableNetwork: true });
    expect(typeof conn.trackNavigation).toBe('function');

    await new Promise((r) => setTimeout(r, 0));
    conn.disconnect();

    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('patches fetch in worker environments when network capture is enabled', async () => {
    vi.spyOn(platform, 'isDevMode').mockReturnValue(true);
    vi.spyOn(platform, 'detectPlatform').mockReturnValue('worker');

    vi.stubGlobal('process', undefined as any);
    const originalFetch = vi.fn(async () => ({ status: 200, headers: { get: () => null } })) as any;
    vi.stubGlobal('fetch', originalFetch);

    class MockWS {
      readyState = 1;
      onopen?: () => void;
      onclose?: () => void;
      constructor(public url: string) {
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send() {}
      close() {
        this.readyState = 3;
        this.onclose && this.onclose();
      }
    }
    vi.stubGlobal('WebSocket', MockWS as any);

    const conn = startBridge({ url: 'ws://localhost:9999', secret: 's', enabled: true, enableNetwork: true });

    expect(globalThis.fetch).not.toBe(originalFetch);

    await (globalThis.fetch as any)('https://example.com/ok');
    conn.disconnect();

    expect(globalThis.fetch).toBe(originalFetch);
  });
});
