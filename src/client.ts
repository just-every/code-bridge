import type { BridgeOptions, BridgeConnection, BridgeEvent, Breadcrumb, LogLevel } from './types';
import { detectPlatform, isDevMode } from './platform';
import { BridgeWebSocket } from './websocket';
import { Throttler } from './throttle';

const DEFAULT_PORT = 9876;
const DEFAULT_URL = `ws://localhost:${DEFAULT_PORT}`;
const DEFAULT_SECRET = 'dev-secret';
const DEFAULT_MAX_BREADCRUMBS = 50;
const DEFAULT_THROTTLE_MS = 100;

export function startBridge(options: BridgeOptions = {}): BridgeConnection {
  // Determine whether to enable the bridge
  // Priority:
  // 1. CODE_BRIDGE=1 env var → force on
  // 2. Explicit enabled: false → force off
  // 3. Explicit enabled: true → force on
  // 4. Dev mode + (url or secret provided) → auto-enable
  // 5. Otherwise → disabled (production default)
  const hasCodeBridgeEnv = typeof process !== 'undefined' && process.env.CODE_BRIDGE === '1';
  const hasExplicitConfig = options.url !== undefined || options.secret !== undefined;
  const shouldEnable = hasCodeBridgeEnv
    ? true
    : (options.enabled !== undefined
      ? options.enabled
      : (isDevMode() && hasExplicitConfig));

  if (!shouldEnable) {
    // No-op in production or when explicitly disabled
    return {
      disconnect: () => {},
    };
  }

  const platform = detectPlatform();
  const url = options.url ?? DEFAULT_URL;
  const secret = options.secret ?? DEFAULT_SECRET;
  const projectId = options.projectId;
  const maxBreadcrumbs = options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;

  const breadcrumbs: Breadcrumb[] = [];
  const throttler = new Throttler(throttleMs);
  const ws = new BridgeWebSocket(url, secret);

  // Connect WebSocket
  ws.connect().catch((err) => {
    console.warn('[code-bridge] Failed to connect:', err.message);
  });

  function addBreadcrumb(level: LogLevel, message: string): void {
    breadcrumbs.push({
      timestamp: Date.now(),
      level,
      message,
    });
    if (breadcrumbs.length > maxBreadcrumbs) {
      breadcrumbs.shift();
    }
  }

  function sendEvent(event: Partial<BridgeEvent>): void {
    if (!throttler.shouldAllow()) return;

    const fullEvent: BridgeEvent = {
      type: event.type ?? 'log',
      level: event.level ?? 'info',
      message: event.message ?? '',
      stack: event.stack,
      timestamp: Date.now(),
      platform,
      projectId,
      breadcrumbs: [...breadcrumbs],
    };

    ws.send(fullEvent);
  }

  // Global error handlers
  const errorHandlers: (() => void)[] = [];

  if (platform === 'web') {
    const handleError = (event: ErrorEvent) => {
      sendEvent({
        type: 'error',
        level: 'error',
        message: event.message,
        stack: event.error?.stack,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      sendEvent({
        type: 'error',
        level: 'error',
        message: `Unhandled rejection: ${event.reason}`,
        stack: event.reason?.stack,
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    errorHandlers.push(() => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    });
  }

  if (platform === 'node') {
    const handleUncaughtException = (error: Error) => {
      sendEvent({
        type: 'error',
        level: 'error',
        message: error.message,
        stack: error.stack,
      });
    };

    const handleUnhandledRejection = (reason: any) => {
      sendEvent({
        type: 'error',
        level: 'error',
        message: `Unhandled rejection: ${reason}`,
        stack: reason?.stack,
      });
    };

    process.on('uncaughtException', handleUncaughtException);
    process.on('unhandledRejection', handleUnhandledRejection);

    errorHandlers.push(() => {
      process.off('uncaughtException', handleUncaughtException);
      process.off('unhandledRejection', handleUnhandledRejection);
    });
  }

  if (platform === 'react-native') {
    // React Native error handling
    const ErrorUtils = (globalThis as any).ErrorUtils;
    if (ErrorUtils) {
      const originalHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        sendEvent({
          type: 'error',
          level: 'error',
          message: `${isFatal ? 'Fatal: ' : ''}${error.message}`,
          stack: error.stack,
        });
        if (originalHandler) {
          originalHandler(error, isFatal);
        }
      });

      errorHandlers.push(() => {
        ErrorUtils.setGlobalHandler(originalHandler);
      });
    }
  }

  // Console patching
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  function patchConsole(method: LogLevel): void {
    const original = originalConsole[method];
    (console as any)[method] = (...args: any[]) => {
      const message = args.map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }).join(' ');

      addBreadcrumb(method, message);

      sendEvent({
        type: 'console',
        level: method,
        message,
      });

      original.apply(console, args);
    };
  }

  patchConsole('log');
  patchConsole('info');
  patchConsole('warn');
  patchConsole('error');
  patchConsole('debug');

  // Return connection handle
  return {
    disconnect: () => {
      // Restore console
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;

      // Remove error handlers
      errorHandlers.forEach((cleanup) => cleanup());

      // Disconnect WebSocket
      ws.disconnect();
    },
  };
}
