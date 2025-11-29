type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | string;

// Normalize strings safely to lowercase; empty string for nullish
export function lower(val: unknown): string {
  if (val === null || val === undefined) return '';
  try {
    return val.toString().toLowerCase();
  } catch {
    return '';
  }
}

const LEVEL_ORDER = ['errors', 'warn', 'info', 'trace'];

export function getSubscriptionLevelForLogLevel(logLevel?: LogLevel): 'errors' | 'warn' | 'info' | 'trace' {
  const lvl = lower(logLevel);
  switch (lvl) {
    case 'error':
      return 'errors';
    case 'warn':
      return 'warn';
    case 'debug':
      return 'trace';
    case 'info':
    case 'log':
    default:
      return 'info';
  }
}

export function subscriptionIncludesLevel(subscribedLevels: string[] | undefined, eventLogLevel?: LogLevel): boolean {
  const levels = subscribedLevels?.length ? subscribedLevels : ['errors'];
  const eventLevel = getSubscriptionLevelForLogLevel(eventLogLevel);
  const eventIndex = LEVEL_ORDER.indexOf(eventLevel);
  return levels.some((level) => LEVEL_ORDER.indexOf(lower(level) as any) >= eventIndex);
}

export function bridgeHasCapability(bridgeCaps: string[] | undefined, capability: string): boolean {
  const cap = lower(capability);
  if (!cap) return false;
  return (bridgeCaps || []).map(lower).includes(cap);
}

export function consumerWantsCapability(consumerCaps: string[] | undefined, capability: string): boolean {
  const requested = (consumerCaps || []).map(lower).filter(Boolean);
  if (!requested.length) return true; // no specific request -> allow
  return requested.includes(lower(capability));
}
