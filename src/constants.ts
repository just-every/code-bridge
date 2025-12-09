// Shared protocol/runtime constants used by the JS client and mirrored by other SDKs.
// Keeping these centralized makes it easier for new language clients to stay in sync
// with the JS defaults and the documented protocol behavior.

export const PROTOCOL_VERSION = 2;

// Heartbeat timings (ms)
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 30_000;

// Reconnect backoff (ms)
export const RECONNECT_INITIAL_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

// Client-side buffering
export const BUFFER_LIMIT = 200;

// Capability identifiers remain stringly-typed across languages; keep the canonical list here
export const CAPABILITIES = {
  CONSOLE: 'console',
  ERROR: 'error',
  PAGEVIEW: 'pageview',
  NAVIGATION: 'navigation',
  SCREENSHOT: 'screenshot',
  NETWORK: 'network',
  CONTROL: 'control',
} as const;

export type CapabilityValue = typeof CAPABILITIES[keyof typeof CAPABILITIES];
