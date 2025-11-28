import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { BridgeOptions, BridgeConnection, BridgeEvent, Breadcrumb, LogLevel, BridgeCapability } from './types';
import { detectPlatform, isDevMode } from './platform';
import { BridgeWebSocket } from './websocket';
import { Throttler } from './throttle';

const DEFAULT_PORT = 9876;
const DEFAULT_URL = `ws://localhost:${DEFAULT_PORT}`;
const DEFAULT_SECRET = 'dev-secret';
const DEFAULT_MAX_BREADCRUMBS = 50;
const DEFAULT_THROTTLE_MS = 100;
const HOST_LOCK = '.code/code-bridge.lock';
const HOST_META = '.code/code-bridge.json';
const HOST_HEARTBEAT_STALE_MS = 15_000;

interface HostMeta {
  url: string;
  port?: number;
  secret: string;
  workspacePath?: string;
  startedAt?: string;
  pid?: number;
  heartbeatAt?: string;
}

export function startBridge(options: BridgeOptions = {}): BridgeConnection {
  // Try to ensure a host is running (best-effort, dev-only). This is intentionally
  // silent on failure so production stays no-op.
  const hostMeta = ensureHostIfPossible(options);

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
      trackPageview: () => {},
      sendScreenshot: () => {},
      onControl: () => {},
    };
  }

  const platform = detectPlatform();
  const url = options.url ?? hostMeta?.url ?? DEFAULT_URL;
  const secret = options.secret ?? hostMeta?.secret ?? DEFAULT_SECRET;
  const projectId = options.projectId;
  const maxBreadcrumbs = options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const enablePageview = options.enablePageview ?? false;
  const enableScreenshot = options.enableScreenshot ?? false;
  const enableControl = options.enableControl ?? false;

  // Build capabilities list (always include error and console, optionally pageview and screenshot)
  const capabilities: BridgeCapability[] = ['error', 'console'];
  if (enablePageview) {
    capabilities.push('pageview');
  }
  if (enableScreenshot) {
    capabilities.push('screenshot');
  }
  if (enableControl) {
    capabilities.push('control');
  }

  const breadcrumbs: Breadcrumb[] = [];
  const throttler = new Throttler(throttleMs);
  const ws = new BridgeWebSocket(url, secret, capabilities, platform, projectId);

  // Hook control handler placeholder; updated via onControl
  let controlHandler: ((msg: any) => void) | null = null;
  ws.setControlHandler((msg) => {
    if (controlHandler) {
      controlHandler(msg);
    } else {
      console.log('[code-bridge] control message received (no handler set):', msg);
    }
  });

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

  // Pageview tracking function
  function trackPageview(params: { url?: string; route?: string }): void {
    if (!enablePageview) {
      console.warn('[code-bridge] Pageview tracking is disabled. Set enablePageview: true in BridgeOptions.');
      return;
    }

    const finalUrl = params.url ?? (platform === 'web' && typeof window !== 'undefined' ? window.location.href : undefined);
    const finalRoute = params.route ?? (platform === 'web' && typeof window !== 'undefined' ? window.location.pathname : undefined);

    sendEvent({
      type: 'pageview',
      level: 'info',
      message: `Pageview: ${finalRoute || finalUrl || 'unknown'}`,
      url: finalUrl,
      route: finalRoute,
    });
  }

  // Screenshot sending function (dev-only, no-op in production)
  function sendScreenshot(params: { mime: string; data: string; url?: string; route?: string }): void {
    if (!enableScreenshot) {
      console.warn('[code-bridge] Screenshot sending is disabled. Set enableScreenshot: true in BridgeOptions.');
      return;
    }

    const finalUrl = params.url ?? (platform === 'web' && typeof window !== 'undefined' ? window.location.href : undefined);
    const finalRoute = params.route ?? (platform === 'web' && typeof window !== 'undefined' ? window.location.pathname : undefined);

    sendEvent({
      type: 'screenshot',
      level: 'info',
      message: `Screenshot: ${finalRoute || finalUrl || 'unknown'}`,
      mime: params.mime,
      data: params.data,
      url: finalUrl,
      route: finalRoute,
    });
  }

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
    trackPageview,
    sendScreenshot,
    onControl: (handler: (msg: any) => void) => {
      controlHandler = handler;
    },
  };
}

// Best-effort host ensure: if metadata is healthy, reuse it; otherwise try to
// spawn code-bridge-host (dev-only) and wait briefly for fresh metadata.
function ensureHostIfPossible(options: BridgeOptions): HostMeta | undefined {
  // Only attempt in dev; production should stay no-op unless explicitly enabled
  if (!isDevMode()) return undefined;

  const workspace = options.projectId ? process.cwd() : process.cwd();
  const lockPath = path.join(workspace, HOST_LOCK);
  const metaPath = path.join(workspace, HOST_META);

  const healthy = readHealthyMeta(metaPath);
  if (healthy) return healthy;

  // Try to start host (non-blocking, best-effort)
  try {
    const bin = resolveHostBin(workspace);
    if (bin) {
      const child = spawn(bin.cmd, bin.args, {
        cwd: workspace,
        stdio: 'ignore',
        detached: true,
        env: process.env,
      });
      child.unref();

      // Poll for fresh metadata up to ~2s
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const fresh = readHealthyMeta(metaPath);
        if (fresh) return fresh;
      }
    }
  } catch (err) {
    // Swallow errors; stay no-op rather than crashing
    return undefined;
  }

  return readHealthyMeta(metaPath);
}

function readHealthyMeta(metaPath: string): HostMeta | undefined {
  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    const meta = JSON.parse(raw) as HostMeta;

    // Basic required fields
    if (!meta.url || !meta.secret) return undefined;

    // Check pid alive if present
    if (meta.pid) {
      try {
        process.kill(meta.pid, 0);
      } catch {
        return undefined;
      }
    }

    // Check heartbeat freshness if present
    if (meta.heartbeatAt) {
      const age = Date.now() - new Date(meta.heartbeatAt).getTime();
      if (age > HOST_HEARTBEAT_STALE_MS) return undefined;
    }

    return meta;
  } catch {
    return undefined;
  }
}

function resolveHostBin(workspace: string): { cmd: string; args: string[] } | undefined {
  // Prefer local node_modules/.bin
  const localBin = path.join(workspace, 'node_modules', '.bin', 'code-bridge-host');
  if (fs.existsSync(localBin)) {
    return { cmd: localBin, args: [workspace] };
  }
  // Fallback to npx (may be slower, but works)
  return { cmd: 'npx', args: ['code-bridge-host', workspace] };
}
