import { describe, it, expect } from 'vitest';
import { lower, subscriptionIncludesLevel, bridgeHasCapability, consumerWantsCapability } from '../host-utils';

describe('host-utils', () => {
  it('lower handles nullish and non-string safely', () => {
    expect(lower(undefined)).toBe('');
    expect(lower(null)).toBe('');
    expect(lower(123)).toBe('123');
  });

  it('subscriptionIncludesLevel respects hierarchy', () => {
    expect(subscriptionIncludesLevel(['warn'], 'error')).toBe(true);
    expect(subscriptionIncludesLevel(['warn'], 'info')).toBe(false);
    expect(subscriptionIncludesLevel(undefined, 'info')).toBe(false); // default errors only
    expect(subscriptionIncludesLevel(['trace'], 'debug')).toBe(true);
  });

  it('capability helpers avoid toLowerCase crashes', () => {
    expect(consumerWantsCapability(undefined, 'network')).toBe(true);
    expect(bridgeHasCapability(undefined, 'network')).toBe(false);
    expect(bridgeHasCapability(['Network'], 'network')).toBe(true);
  });
});
