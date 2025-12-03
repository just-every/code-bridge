import type { BridgeCapability, SubscriptionLevel } from '../types';
import type { LlmFilter } from './types';

const LEVELS: SubscriptionLevel[] = ['errors', 'warn', 'info', 'trace'];
const CAPS: BridgeCapability[] = ['error', 'console', 'pageview', 'navigation', 'screenshot', 'network', 'control'];
const FILTERS: LlmFilter[] = ['off', 'minimal', 'aggressive'];

export function validateSubscribeArgs(raw: any) {
  const levels = normalizeArray(raw?.levels ?? ['errors'], LEVELS, 'levels');
  const capabilities = raw?.capabilities ? normalizeArray(raw.capabilities, CAPS, 'capabilities') : undefined;
  const llm_filter = raw?.llm_filter ? normalizeOne(raw.llm_filter, FILTERS, 'llm_filter') : undefined;
  return { levels, capabilities, llm_filter };
}

export function validateControlArgs(raw: any) {
  if (!raw || typeof raw !== 'object') throw new Error('control arguments must be an object');
  if (!raw.action || typeof raw.action !== 'string') throw new Error('control action is required');
  const timeoutMs = raw.timeoutMs !== undefined ? coercePositiveInt(raw.timeoutMs, 'timeoutMs', 10000) : 10000;
  const expectResult = raw.expectResult !== undefined ? Boolean(raw.expectResult) : true;
  return {
    action: raw.action,
    args: raw.args,
    code: typeof raw.code === 'string' ? raw.code : undefined,
    timeoutMs,
    expectResult,
  };
}

function normalizeArray<T extends string>(val: unknown, allowed: readonly T[], field: string): T[] {
  if (val === undefined) return [];
  if (!Array.isArray(val)) throw new Error(`${field} must be an array`);
  const normalized: T[] = [];
  val.forEach((item) => {
    if (typeof item !== 'string') throw new Error(`${field} must contain strings`);
    const lower = item.toLowerCase() as T;
    if (!allowed.includes(lower)) {
      throw new Error(`${field} has invalid entry: ${item}`);
    }
    if (!normalized.includes(lower)) normalized.push(lower);
  });
  return normalized.length ? normalized : [];
}

function normalizeOne<T extends string>(val: unknown, allowed: readonly T[], field: string): T {
  if (typeof val !== 'string') throw new Error(`${field} must be a string`);
  const lower = val.toLowerCase() as T;
  if (!allowed.includes(lower)) throw new Error(`${field} has invalid value: ${val}`);
  return lower;
}

function coercePositiveInt(val: unknown, field: string, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || num <= 0) throw new Error(`${field} must be a positive number`);
  return num;
}
