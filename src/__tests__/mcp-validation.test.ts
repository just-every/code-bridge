import { describe, it, expect } from 'vitest';
import { validateSubscribeArgs, validateControlArgs } from '../mcp/validation';

describe('validateSubscribeArgs', () => {
  it('accepts defaults when empty', () => {
    const parsed = validateSubscribeArgs({});
    expect(parsed.levels.length).toBeGreaterThan(0);
  });

  it('normalizes arrays', () => {
    const parsed = validateSubscribeArgs({ levels: ['INFO', 'errors'], capabilities: ['network', 'console'] });
    expect(parsed.levels).toContain('info');
    expect(parsed.capabilities).toContain('network');
  });

  it('rejects invalid level', () => {
    expect(() => validateSubscribeArgs({ levels: ['nope'] })).toThrow();
  });
});

describe('validateControlArgs', () => {
  it('requires action', () => {
    expect(() => validateControlArgs({})).toThrow();
  });

  it('parses timeout and code', () => {
    const parsed = validateControlArgs({ action: 'eval', code: '1+1', timeoutMs: 2000 });
    expect(parsed.timeoutMs).toBe(2000);
    expect(parsed.code).toBe('1+1');
  });
});
