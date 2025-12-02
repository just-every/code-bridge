import type {
  BridgeOptions,
  BridgeConnection,
  BridgeEvent,
  Breadcrumb,
  LogLevel,
  BridgeCapability,
  NavigationInfo,
  ControlRequestMessage,
} from './types';
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

const NODE_NETWORK_PATCHED = Symbol.for('code-bridge-node-network-patched');

type NodeNetworkSink = {
  sendEvent: (ev: Partial<BridgeEvent>, opts?: { bypassThrottle?: boolean }) => void;
  addBreadcrumb: (level: LogLevel, message: string) => void;
  bridgeUrl?: string;
};

type NodeNetworkPatchState = {
  count: number;
  sinks: NodeNetworkSink[];
  restore: () => void;
};

function randomId(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function instrumentBrowserFetch(
  sendEvent: (ev: Partial<BridgeEvent>, opts?: { bypassThrottle?: boolean }) => void,
  addBreadcrumb: (level: LogLevel, message: string) => void,
  bridgeUrl?: string,
): () => void {
  const target: any = typeof window !== 'undefined' ? window : globalThis;
  const fetchImpl = target.fetch ?? (globalThis as any).fetch;
  if (typeof fetchImpl !== 'function') return () => {};
  const originalFetch = fetchImpl;
  const callFetch = fetchImpl.bind(target);

  target.fetch = (async (...args: any[]) => {
    const requestId = randomId();
    const started = performance?.now ? performance.now() : Date.now();
    let urlStr = '';
    let method = 'GET';
    try {
      const [input, init] = args as [RequestInfo | URL, RequestInit?];
      method = (init?.method || (input as any)?.method || 'GET').toString().toUpperCase();
      urlStr = typeof input === 'string' ? input : (input as any)?.url || String(input);
      if (bridgeUrl && urlStr.includes(bridgeUrl)) {
        return callFetch(...args as any);
      }
      const requestSize = approxBodySize(init?.body);
      const response = await callFetch(...args as any);
      const durationMs = (performance?.now ? performance.now() : Date.now()) - started;
      const status = (response as Response).status;
      const ok = status < 400;
      const responseSizeHeader = (response as Response).headers?.get('content-length');
      const responseSize = responseSizeHeader ? Number(responseSizeHeader) || undefined : undefined;
      const message = `${method} ${urlStr} -> ${status}`;
      addBreadcrumb(ok ? 'info' : 'warn', message);
      sendEvent({
        type: 'network',
        level: ok ? 'info' : 'error',
        message,
        network: {
          requestId,
          url: urlStr,
          method,
          status,
          ok,
          durationMs,
          requestSize,
          responseSize,
          transport: 'fetch',
        },
      }, { bypassThrottle: !ok });
      return response;
    } catch (err: any) {
      const durationMs = (performance?.now ? performance.now() : Date.now()) - started;
      sendEvent({
        type: 'network',
        level: 'error',
        message: `${method} ${urlStr} -> ${err?.message || 'fetch failed'}`,
        stack: err?.stack,
        network: {
          requestId,
          url: urlStr,
          method,
          durationMs,
          errorMessage: err?.message,
          transport: 'fetch',
        },
      }, { bypassThrottle: true });
      throw err;
    }
  }) as any;

  return () => {
    target.fetch = originalFetch as any;
  };
}

function instrumentBrowserXhr(
  sendEvent: (ev: Partial<BridgeEvent>, opts?: { bypassThrottle?: boolean }) => void,
  addBreadcrumb: (level: LogLevel, message: string) => void,
  bridgeUrl?: string,
): () => void {
  if (typeof window === 'undefined' || typeof XMLHttpRequest === 'undefined') return () => {};
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function patchedOpen(this: XMLHttpRequest, method: string, urlStr: string, ...rest: any[]) {
    (this as any).__cb_method = (method || 'GET').toUpperCase();
    (this as any).__cb_url = urlStr;
    return (originalOpen as any).apply(this, [method, urlStr, ...rest]);
  } as any;

  proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | BodyInit | null): void {
    const xhr = this as XMLHttpRequest & { __cb_method?: string; __cb_url?: string };
    const method = xhr.__cb_method || 'GET';
    const urlStr = xhr.__cb_url || '';
    if (bridgeUrl && urlStr.includes(bridgeUrl)) {
      return originalSend.call(xhr, body as any);
    }
    const start = performance?.now ? performance.now() : Date.now();
    const requestSize = approxBodySize(body);
    const requestId = randomId();

    const finalize = (status: number | undefined, errorMessage?: string) => {
      const durationMs = (performance?.now ? performance.now() : Date.now()) - start;
      const ok = status !== undefined ? status < 400 : false;
      let responseSize: number | undefined;
      try {
        const responseType = xhr.responseType;
        if (responseType === '' || responseType === 'text') {
          responseSize = xhr.responseText ? new TextEncoder().encode(xhr.responseText).length : undefined;
        } else if (responseType === 'arraybuffer' && xhr.response instanceof ArrayBuffer) {
          responseSize = xhr.response.byteLength;
        } else if (responseType === 'blob' && xhr.response instanceof Blob) {
          responseSize = xhr.response.size;
        }
      } catch {
        responseSize = undefined;
      }

      const statusNumber = status ?? 0;
      const message = `${method} ${urlStr} -> ${statusNumber || 'error'}`;
      addBreadcrumb(ok ? 'info' : 'warn', message);
      sendEvent({
        type: 'network',
        level: ok ? 'info' : 'error',
        message,
        network: {
          requestId,
          url: urlStr,
          method,
          status: statusNumber || undefined,
          ok,
          durationMs,
          requestSize,
          responseSize,
          transport: 'xhr',
          errorMessage,
        },
      }, { bypassThrottle: !ok });
    };

    xhr.addEventListener('loadend', () => finalize(xhr.status));
    xhr.addEventListener('error', () => finalize(xhr.status || 0, 'error'));
    xhr.addEventListener('abort', () => finalize(xhr.status || 0, 'abort'));
    xhr.addEventListener('timeout', () => finalize(xhr.status || 0, 'timeout'));

    return originalSend.call(xhr, body as any);
  } as any;

  return () => {
    proto.open = originalOpen;
    proto.send = originalSend;
  };
}

export function instrumentNodeNetwork(
  sendEvent: (ev: Partial<BridgeEvent>, opts?: { bypassThrottle?: boolean }) => void,
  addBreadcrumb: (level: LogLevel, message: string) => void,
  bridgeUrl?: string,
  fetchImpl?: typeof fetch,
  httpMod?: any,
  httpsMod?: any,
): () => void {
  if (typeof process === 'undefined' || !process.versions?.node) return () => {};
  const globalAny: any = globalThis as any;
  const sink: NodeNetworkSink = { sendEvent, addBreadcrumb, bridgeUrl };

  const getState = (): NodeNetworkPatchState | undefined => globalAny[NODE_NETWORK_PATCHED] as NodeNetworkPatchState | undefined;

  const detach = (targetSink: NodeNetworkSink) => () => {
    const current = getState();
    if (!current) return;
    current.sinks = current.sinks.filter((s) => s !== targetSink);
    current.count = Math.max(0, current.count - 1);
    if (current.count === 0 || current.sinks.length === 0) {
      current.restore();
      delete globalAny[NODE_NETWORK_PATCHED];
    }
  };

  const existing = getState();
  if (existing) {
    existing.count += 1;
    existing.sinks.push(sink);
    return detach(sink);
  }

  const http = httpMod || require('http');
  const https = httpsMod || require('https');

  const dispatchNetwork = (payload: {
    requestId: string;
    url: string;
    method: string;
    status?: number;
    ok?: boolean;
    durationMs: number;
    requestSize?: number;
    responseSize?: number;
    transport: 'http' | 'https' | 'fetch';
    errorMessage?: string;
    message: string;
    breadcrumbLevel: LogLevel;
    eventLevel: LogLevel;
    bypassThrottle?: boolean;
  }) => {
    const state = getState();
    const sinks = state?.sinks ?? [];
    if (!sinks.length) return;

    const bypass = payload.bypassThrottle ?? (payload.ok === undefined ? true : !payload.ok);

    for (const target of sinks) {
      if (target.bridgeUrl && payload.url && payload.url.includes(target.bridgeUrl)) continue;

      target.addBreadcrumb(payload.breadcrumbLevel, payload.message);
      target.sendEvent({
        type: 'network',
        level: payload.eventLevel,
        message: payload.message,
        network: {
          requestId: payload.requestId,
          url: payload.url,
          method: payload.method,
          status: payload.status,
          ok: payload.ok,
          durationMs: payload.durationMs,
          requestSize: payload.requestSize,
          responseSize: payload.responseSize,
          transport: payload.transport,
          errorMessage: payload.errorMessage,
        },
      }, { bypassThrottle: bypass });
    }
  };

  const patchModule = (mod: any, transport: 'http' | 'https') => {
    const originalRequest = mod.request;
    const originalGet = mod.get;

    mod.request = function patchedRequest(...args: any[]) {
      const { url: urlStr, method } = normalizeNodeRequestArgs(args, transport);
      const requestId = randomId();
      const start = Date.now();
      let requestSize = 0;
      let finished = false;

      const req = originalRequest.apply(mod, args as any);

      const trackChunk = (chunk?: any, encoding?: BufferEncoding) => {
        if (!chunk) return;
        if (Buffer.isBuffer(chunk)) {
          requestSize += chunk.length;
        } else {
          requestSize += Buffer.byteLength(String(chunk), encoding);
        }
      };

      const originalWrite = req.write;
      req.write = function patchedWrite(chunk: any, encoding?: BufferEncoding, cb?: any) {
        trackChunk(chunk, encoding);
        return originalWrite.call(req, chunk, encoding, cb);
      };

      const originalEnd = req.end;
      req.end = function patchedEnd(chunk?: any, encoding?: BufferEncoding, cb?: any) {
        trackChunk(chunk, encoding);
        return originalEnd.call(req, chunk, encoding, cb);
      };

      req.on('response', (res: any) => {
        let responseSize = 0;
        res.on('data', (chunk: any) => {
          if (chunk) responseSize += chunk.length;
        });
        res.on('end', () => {
          if (finished) return;
          finished = true;
          const durationMs = Date.now() - start;
          const status = res.statusCode || 0;
          const ok = status < 400;
          const message = `${method} ${urlStr} -> ${status}`;
          dispatchNetwork({
            requestId,
            url: urlStr,
            method,
            status,
            ok,
            durationMs,
            requestSize,
            responseSize,
            transport,
            message,
            breadcrumbLevel: ok ? 'info' : 'warn',
            eventLevel: ok ? 'info' : 'error',
            bypassThrottle: !ok,
          });
        });
      });

      req.on('error', (err: any) => {
        if (finished) return;
        finished = true;
        const durationMs = Date.now() - start;
        const message = `${method} ${urlStr} -> ${err?.message || 'request error'}`;
        dispatchNetwork({
          requestId,
          url: urlStr,
          method,
          durationMs,
          requestSize,
          transport,
          message,
          errorMessage: err?.message,
          breadcrumbLevel: 'error',
          eventLevel: 'error',
          bypassThrottle: true,
        });
      });

      return req;
    };

    mod.get = function patchedGet(...args: any[]) {
      const req = mod.request(...args as any);
      req.end();
      return req;
    };

    return () => {
      mod.request = originalRequest;
      mod.get = originalGet;
    };
  };

  const unpatchHttp = patchModule(http, 'http');
  const unpatchHttps = patchModule(https, 'https');

  const originalFetch = fetchImpl ?? (globalAny.fetch as any) ?? null;
  let restoreFetch = () => {};
  if (typeof originalFetch === 'function') {
    const callFetch = originalFetch.bind(globalAny);
    globalAny.fetch = async (...args: any[]) => {
      const requestId = randomId();
      const started = Date.now();
      let urlStr = '';
      let method = 'GET';
      try {
        const [input, init] = args as [RequestInfo | URL, RequestInit?];
        method = (init?.method || (input as any)?.method || 'GET').toString().toUpperCase();
        urlStr = typeof input === 'string' ? input : (input as any)?.url || String(input);
        const requestSize = approxBodySize(init?.body as any);
        const res = await callFetch(...args as any);
        const durationMs = Date.now() - started;
        const status = (res as any).status ?? 0;
        const ok = status < 400;
        let responseSize: number | undefined;
        try {
          const len = (res as any).headers?.get?.('content-length');
          responseSize = len ? Number(len) || undefined : undefined;
        } catch {
          responseSize = undefined;
        }
        const message = `${method} ${urlStr} -> ${status}`;
        dispatchNetwork({
          requestId,
          url: urlStr,
          method,
          status,
          ok,
          durationMs,
          requestSize,
          responseSize,
          transport: 'fetch',
          message,
          breadcrumbLevel: ok ? 'info' : 'warn',
          eventLevel: ok ? 'info' : 'error',
          bypassThrottle: !ok,
        });
        return res;
      } catch (err: any) {
        const durationMs = Date.now() - started;
        const message = `${method} ${urlStr} -> ${err?.message || 'fetch error'}`;
        dispatchNetwork({
          requestId,
          url: urlStr,
          method,
          durationMs,
          transport: 'fetch',
          message,
          errorMessage: err?.message,
          breadcrumbLevel: 'error',
          eventLevel: 'error',
          bypassThrottle: true,
        });
        throw err;
      }
    };

    restoreFetch = () => {
      globalAny.fetch = originalFetch;
    };
  }

  const state: NodeNetworkPatchState = {
    count: 1,
    sinks: [sink],
    restore: () => {
      unpatchHttp();
      unpatchHttps();
      restoreFetch();
    },
  };
  globalAny[NODE_NETWORK_PATCHED] = state;

  return detach(sink);
}

function normalizeNodeRequestArgs(args: any[], transport: 'http' | 'https'): { url: string; method: string } {
  const first = args[0];
  const second = args[1];
  let urlStr = '';
  let method = 'GET';

  if (typeof first === 'string') {
    urlStr = first;
    if (typeof second === 'object' && second?.method) {
      method = second.method.toString().toUpperCase();
    }
  } else if (first && typeof first === 'object') {
    const opts = first as any;
    method = (opts.method || 'GET').toString().toUpperCase();
    if (opts.href) {
      urlStr = opts.href;
    } else {
      const host = opts.hostname || opts.host || 'localhost';
      const port = opts.port ? `:${opts.port}` : '';
      const path = opts.path || '/';
      urlStr = `${transport}://${host}${port}${path}`;
    }
  }
  return { url: urlStr, method };
}

function approxBodySize(body: any): number | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') {
    try {
      return new TextEncoder().encode(body).length;
    } catch {
      return Buffer.byteLength(body);
    }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body.length;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  return undefined;
}

function safeSerialize(value: any, depth = 3, seen = new WeakSet()): any {
  if (depth <= 0) return '[depth limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return value.toString();
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => safeSerialize(item, depth - 1, seen));
  }
  if (typeof value === 'object') {
    const output: Record<string, any> = {};
    const keys = Object.keys(value).slice(0, 20);
    for (const key of keys) {
      try {
        output[key] = safeSerialize((value as any)[key], depth - 1, seen);
      } catch (err) {
        output[key] = `[error serializing: ${(err as Error).message}]`;
      }
    }
    return output;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

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
      trackNavigation: () => {},
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
  // Navigation and network are now opt-out (default: true)
  const enableNavigation = options.enableNavigation ?? true;
  const enableNetwork = options.enableNetwork ?? true;
  const enableScreenshot = options.enableScreenshot ?? Boolean(options.screenshotProvider);
  const enableControl = options.enableControl ?? false;
  const screenshotProvider = options.screenshotProvider;

  // Build capabilities list (always include error and console, optionally extras)
  const capabilities: BridgeCapability[] = ['error', 'console'];
  if (enablePageview) {
    capabilities.push('pageview');
  }
  if (enableNavigation) {
    capabilities.push('navigation');
  }
  if (enableScreenshot) {
    capabilities.push('screenshot');
  }
  if (enableNetwork) {
    capabilities.push('network');
  }
  if (enableControl) {
    capabilities.push('control');
  }

  const breadcrumbs: Breadcrumb[] = [];
  const throttler = new Throttler(throttleMs);
  const ws = new BridgeWebSocket(url, secret, capabilities, platform, projectId);

  // Hook control handler placeholder; updated via onControl
  let controlHandler: ((msg: ControlRequestMessage) => Promise<any> | any) | null = null;
  ws.setControlHandler((msg) => {
    if (controlHandler) {
      return controlHandler(msg);
    }
    if (msg.action === 'screenshot') {
      if (!screenshotProvider) {
        throw new Error('Screenshot provider not configured');
      }
      return screenshotProvider().then((shot) => {
        sendScreenshot({ mime: shot.mime, data: shot.data });
        return { ok: true };
      });
    }
    // Default: attempt lightweight dev eval for convenience
    if (msg.action === 'eval' && msg.code) {
      // eslint-disable-next-line no-new-func
      const fn = new Function(msg.code);
      return fn();
    }
    console.log('[code-bridge] control message received (no handler set):', msg);
    return undefined;
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

  function sendEvent(event: Partial<BridgeEvent>, options?: { bypassThrottle?: boolean }): void {
    const bypass = options?.bypassThrottle || event.type === 'error' || event.type === 'navigation' || event.type === 'network';
    if (!bypass && !throttler.shouldAllow()) return;

    const fullEvent: BridgeEvent = {
      type: event.type ?? 'log',
      level: event.level ?? 'info',
      message: event.message ?? '',
      stack: event.stack,
      timestamp: Date.now(),
      platform,
      projectId,
      breadcrumbs: [...breadcrumbs],
      url: event.url,
      route: event.route,
      mime: event.mime,
      data: event.data,
      args: event.args,
      navigation: event.navigation,
      network: event.network,
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
        url: window.location.href,
        route: window.location.pathname,
      }, { bypassThrottle: true });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      sendEvent({
        type: 'error',
        level: 'error',
        message: `Unhandled rejection: ${event.reason}`,
        stack: event.reason?.stack,
        url: window.location.href,
        route: window.location.pathname,
      }, { bypassThrottle: true });
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
      }, { bypassThrottle: true });
    };

    const handleUnhandledRejection = (reason: any) => {
      sendEvent({
        type: 'error',
        level: 'error',
        message: `Unhandled rejection: ${reason}`,
        stack: reason?.stack,
      }, { bypassThrottle: true });
    };

    if (typeof process.on === 'function') {
      process.on('uncaughtException', handleUncaughtException);
      process.on('unhandledRejection', handleUnhandledRejection);
    }

    errorHandlers.push(() => {
      if (typeof process.off === 'function') {
        process.off('uncaughtException', handleUncaughtException);
        process.off('unhandledRejection', handleUnhandledRejection);
      }
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
      const serializedArgs = safeSerialize(args);
      const message = args.map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.message;
        return JSON.stringify(safeSerialize(arg));
      }).join(' ');

      addBreadcrumb(method, message);

      sendEvent({
        type: 'console',
        level: method,
        message,
        args: serializedArgs,
      }, { bypassThrottle: method === 'error' || method === 'warn' });

      original.apply(console, args);
    };
  }

  patchConsole('log');
  patchConsole('info');
  patchConsole('warn');
  patchConsole('error');
  patchConsole('debug');

  // Navigation tracking (SPA + hash changes)
  if (platform === 'web' && enableNavigation && typeof window !== 'undefined' && typeof history !== 'undefined') {
    let lastUrl = window.location.href;

    const emitNavigation = (initiator: NavigationInfo['initiator'], toUrl: string, fromUrl?: string) => {
      const route = (() => {
        try {
          return new URL(toUrl, window.location.origin).pathname;
        } catch {
          return undefined;
        }
      })();

      const message = `Navigation (${initiator}): ${fromUrl || 'unknown'} -> ${toUrl}`;
      addBreadcrumb('info', message);
      sendEvent({
        type: 'navigation',
        level: 'info',
        message,
        url: toUrl,
        route,
        navigation: { from: fromUrl, to: toUrl, route, initiator },
      }, { bypassThrottle: true });
    };

    const wrapHistory = (method: 'pushState' | 'replaceState') => {
      const original = history[method];
      history[method] = function patchedHistory(this: History, ...args: any[]) {
        const prev = lastUrl;
        const result = original.apply(this, args as any);
        const next = window.location.href;
        if (next !== prev) {
          emitNavigation(method === 'pushState' ? 'pushState' : 'replaceState', next, prev);
          lastUrl = next;
        }
        return result;
      } as any;
      errorHandlers.push(() => {
        history[method] = original;
      });
    };

    wrapHistory('pushState');
    wrapHistory('replaceState');

    const handlePopState = () => {
      const prev = lastUrl;
      const next = window.location.href;
      if (next !== prev) {
        emitNavigation('popstate', next, prev);
        lastUrl = next;
      }
    };
    const handleHash = () => {
      const prev = lastUrl;
      const next = window.location.href;
      if (next !== prev) {
        emitNavigation('hashchange', next, prev);
        lastUrl = next;
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHash);

    errorHandlers.push(() => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHash);
    });

    // Initial load navigation event
    emitNavigation('load', lastUrl, undefined);
  }

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

  function trackNavigation(info: NavigationInfo): void {
    if (!enableNavigation) return;
    const message = `Navigation (${info.initiator}): ${info.from ?? 'unknown'} -> ${info.to}`;
    sendEvent({
      type: 'navigation',
      level: 'info',
      message,
      url: info.to,
      route: info.route,
      navigation: info,
    }, { bypassThrottle: true });
  }

  // Network capture (browser)
  if ((platform === 'web' || platform === 'worker') && enableNetwork) {
    const detachFetch = instrumentBrowserFetch(sendEvent, addBreadcrumb, url);
    const detachXhr = platform === 'web' ? instrumentBrowserXhr(sendEvent, addBreadcrumb, url) : () => {};
    errorHandlers.push(() => {
      detachFetch();
      detachXhr();
    });
  }

  // Network capture (node)
  if (platform === 'node' && enableNetwork) {
    const detachNode = instrumentNodeNetwork(sendEvent, addBreadcrumb, url);
    errorHandlers.push(detachNode);
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
    trackNavigation,
    sendScreenshot,
    onControl: (handler: (msg: ControlRequestMessage) => Promise<any> | any) => {
      controlHandler = handler;
    },
  };
}

// Best-effort host ensure: if metadata is healthy, reuse it; otherwise try to
// spawn code-bridge-host (dev-only) and wait briefly for fresh metadata.
function ensureHostIfPossible(options: BridgeOptions): HostMeta | undefined {
  // Only attempt in dev; production should stay no-op unless explicitly enabled
  if (!isDevMode()) return undefined;

  // Host auto-spawn only makes sense in Node environments; browsers/React Native/Workers skip
  if (typeof process === 'undefined' || !process.versions?.node) {
    return undefined;
  }

  // Lazy-load Node built-ins to stay bundler-safe for web/worker
  let fs: typeof import('node:fs');
  let path: typeof import('node:path');
  let spawn: typeof import('node:child_process').spawn;
  try {
    fs = require('node:fs');
    path = require('node:path');
    spawn = require('node:child_process').spawn;
  } catch {
    return undefined;
  }

  const workspace = process.cwd();
  const lockPath = path.join(workspace, HOST_LOCK);
  const metaPath = path.join(workspace, HOST_META);

  const healthy = readHealthyMeta(metaPath, fs);
  if (healthy) return healthy;

  // Try to start host (non-blocking, best-effort)
  try {
    const bin = resolveHostBin(workspace, fs, path);
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
        const fresh = readHealthyMeta(metaPath, fs);
        if (fresh) return fresh;
      }
    }
  } catch (err) {
    // Swallow errors; stay no-op rather than crashing
    return undefined;
  }

  return readHealthyMeta(metaPath, fs);
}

function readHealthyMeta(metaPath: string, fs: typeof import('node:fs')): HostMeta | undefined {
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

    // If no heartbeat or pid is present (older hosts), fall back to file mtime as staleness signal
    if (!meta.heartbeatAt && !meta.pid) {
      const stat = fs.statSync(metaPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > HOST_HEARTBEAT_STALE_MS) return undefined;
    }

    return meta;
  } catch {
    return undefined;
  }
}

function resolveHostBin(
  workspace: string,
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
): { cmd: string; args: string[] } | undefined {
  // Prefer local node_modules/.bin
  const localBin = path.join(workspace, 'node_modules', '.bin', 'code-bridge-host');
  if (fs.existsSync(localBin)) {
    return { cmd: localBin, args: [workspace] };
  }
  // Fallback to npx (may be slower, but works)
  return { cmd: 'npx', args: ['code-bridge-host', workspace] };
}
