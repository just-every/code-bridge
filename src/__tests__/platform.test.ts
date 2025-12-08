import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('platform env helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as any).__CODE_BRIDGE_ENV__;
    globalThis.Function = originalFunction;
  });

  const originalFunction = globalThis.Function;

  it('reads env vars even when process exists without a Node version', async () => {
    vi.stubGlobal('process', { env: { CODE_BRIDGE: '1' } } as any);

    const platform = await import('../platform');

    expect(platform.isNode).toBe(false);
    expect(platform.getEnv('CODE_BRIDGE')).toBe('1');
  });

  it('falls back to __CODE_BRIDGE_ENV__ when process.env is unavailable', async () => {
    vi.stubGlobal('process', undefined as any);
    (globalThis as any).__CODE_BRIDGE_ENV__ = { CODE_BRIDGE: '1' };

    const platform = await import('../platform');

    expect(platform.getEnv('CODE_BRIDGE')).toBe('1');
    expect(platform.getEnvObj()).toEqual({ CODE_BRIDGE: '1' });
  });

  it('reads CODE_BRIDGE and NODE_ENV from import.meta.env fallback when available', async () => {
    vi.stubGlobal('process', undefined as any);

    // Stub Function constructor to simulate import.meta.env presence
    const FakeFunction: any = function (...args: string[]) {
      if (args.some((arg) => `${arg}`.includes('import.meta.env'))) {
        return () => ({ CODE_BRIDGE: '1', NODE_ENV: 'development', DEV: true });
      }
      return (originalFunction as any)(...args);
    };
    FakeFunction.prototype = originalFunction.prototype;
    globalThis.Function = FakeFunction;

    const platform = await import('../platform');

    expect(platform.getEnv('CODE_BRIDGE')).toBe('1');
    expect(platform.getEnv('NODE_ENV')).toBe('development');
    expect(platform.isDevMode()).toBe(true);
  });
});
