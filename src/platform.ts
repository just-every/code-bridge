import type { Platform } from './types';

// We intentionally avoid import.meta access because Metro/Hermes bundle the ESM build
// into non-module scripts, which throws a SyntaxError when import.meta appears in code.
export const isNode = typeof process !== 'undefined' && !!(process as any)?.versions?.node;

const getProcessEnv = (): Record<string, string> | undefined => {
  if (typeof process === 'undefined') return undefined;
  const env = (process as any)?.env;
  return env && typeof env === 'object' ? env : undefined;
};
// Optional environment injections for non-Node runtimes:
// - globalThis.__CODE_BRIDGE_ENV__ can be set by bundlers/user code to expose env-like values
// - import.meta.env (accessed safely via a generated function) for Vite-style builds
const getGlobalEnv = (): Record<string, string> | undefined => {
  const env = (globalThis as any).__CODE_BRIDGE_ENV__;
  return env && typeof env === 'object' ? env : undefined;
};

const getImportMetaEnv = (): Record<string, any> | undefined => {
  try {
    // Avoid direct import.meta usage to stay compatible with non-module runtimes (Hermes/Metro).
    // The Function body is parsed at runtime; SyntaxError is caught and ignored when unsupported.
    // eslint-disable-next-line no-new-func
    return new Function('return (typeof import !== "undefined" && import.meta && import.meta.env) ? import.meta.env : undefined;')();
  } catch {
    return undefined;
  }
};

export const getEnv = (key: string): string | undefined => {
  const procEnv = getProcessEnv();
  if (procEnv && procEnv[key] !== undefined) {
    return procEnv[key];
  }
  const globalEnv = getGlobalEnv();
  if (globalEnv && globalEnv[key] !== undefined) {
    return globalEnv[key];
  }
  const importMetaEnv = getImportMetaEnv();
  if (importMetaEnv && importMetaEnv[key] !== undefined) {
    return importMetaEnv[key];
  }
  return undefined;
};

export const getEnvObj = (): Record<string, string> | undefined => {
  return getProcessEnv() ?? getGlobalEnv() ?? (getImportMetaEnv() as any);
};

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
      !isNode) {
    return 'worker';
  }
  if (isNode) {
    return 'node';
  }
  return 'unknown';
}

export function isDevMode(): boolean {
  // CODE_BRIDGE=1 acts as a force-on override (checked in client.ts via enabled option)
  // Here we detect typical dev environments
  if (getEnv('NODE_ENV') === 'development') {
    return true;
  }

  // Allow forcing dev mode for environments without import.meta (e.g., Metro web)
  if (typeof globalThis !== 'undefined' && (globalThis as any).__CODE_BRIDGE_DEV__ === true) {
    return true;
  }

  if (typeof globalThis !== 'undefined' && (globalThis as any).__DEV__) {
    return true;
  }

  const importMetaEnv = getImportMetaEnv();
  if (importMetaEnv && importMetaEnv.DEV === true) {
    return true;
  }

  return false;
}
