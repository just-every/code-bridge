import type { Platform } from './types';

export function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'react-native';
  }
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'web';
  }
  // Cloudflare/workerd style environment: global WebSocket, no window/document/process
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).WebSocket === 'function' &&
      typeof window === 'undefined' && typeof document === 'undefined' &&
      (typeof process === 'undefined' || !(process as any).versions?.node)) {
    return 'worker';
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

  // Allow forcing dev mode for environments without import.meta (e.g., Metro web)
  if (typeof globalThis !== 'undefined' && (globalThis as any).__CODE_BRIDGE_DEV__ === true) {
    return true;
  }

  if (typeof globalThis !== 'undefined' && (globalThis as any).__DEV__) {
    return true;
  }

  return false;
}
