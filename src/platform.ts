import type { Platform } from './types';

export function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'react-native';
  }
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'web';
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node';
  }
  return 'unknown';
}

export function isDevMode(): boolean {
  // CODE_BRIDGE=1 acts as a force-on override (checked in client.ts via enabled option)
  // Here we detect typical dev environments
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    return true;
  }

  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
      return true;
    }
  } catch {
    // ignore
  }

  if (typeof globalThis !== 'undefined' && (globalThis as any).__DEV__) {
    return true;
  }

  return false;
}
