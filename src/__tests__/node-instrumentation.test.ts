import { describe, it, expect, afterEach } from 'vitest';
import type { BridgeEvent, LogLevel } from '../types';
import { instrumentNodeNetwork } from '../client';

const NODE_NETWORK_PATCHED = Symbol.for('code-bridge-node-network-patched');

function makeSendEvent() {
  const events: BridgeEvent[] = [] as any;
  const sendEvent = (e: any) => events.push(e as BridgeEvent);
  // expose so control handler can push
  (globalThis as any).__nodeSent = events;
  return { events, sendEvent };
}

function makeAddBreadcrumb() {
  const crumbs: { level: LogLevel; message: string }[] = [];
  return {
    crumbs,
    addBreadcrumb: (level: LogLevel, message: string) => crumbs.push({ level, message }),
  };
}

afterEach(() => {
  const state = (globalThis as any)[NODE_NETWORK_PATCHED];
  if (state?.restore) {
    try {
      state.restore();
    } catch {
      // ignore cleanup failures in tests
    }
  }
  delete (globalThis as any)[NODE_NETWORK_PATCHED];
});

describe('node instrumentation (unit)', () => {
  it('emits fetch 404 as error', async () => {
    const { events, sendEvent } = makeSendEvent();
    const { addBreadcrumb } = makeAddBreadcrumb();

    const fetchImpl = async (url: string) => ({
      status: url.includes('404') ? 404 : 200,
      headers: { get: () => '0' },
    });

    const restore = instrumentNodeNetwork(sendEvent, addBreadcrumb, undefined, fetchImpl as any);
    await (globalThis as any).fetch('https://example.com/404');
    restore();

    const evt = events.find((e) => e.type === 'network');
    expect(evt?.network?.status).toBe(404);
    expect(evt?.level).toBe('error');
  });

  it('emits http 200 and 500 responses', async () => {
    const { events, sendEvent } = makeSendEvent();
    const { addBreadcrumb } = makeAddBreadcrumb();

    // stub http/https modules; emit 'response' on req (what instrumentation listens to)
    const makeHttp = (status: number) => ({
      request: (_opts: any, cb?: any) => {
        const req: any = new (require('events').EventEmitter)();
        req.write = () => {};
        req.end = () => {
          const res: any = new (require('events').EventEmitter)();
          res.statusCode = status;
          res.on = res.addListener.bind(res);
          cb && cb(res);
          res.emit('data', Buffer.from('x'));
          res.emit('end');
        };
        req.on = req.addListener.bind(req);
        setTimeout(() => {
          req.emit('response', { statusCode: status, on: (ev: string, fn: any) => { if (ev === 'data') fn(Buffer.from('x')); if (ev === 'end') fn(); } });
        }, 0);
        return req;
      },
      get: function (...args: any[]) { const r = this.request(...args); r.end(); return r; },
    });

    const httpModule = makeHttp(200);
    const httpsModule = makeHttp(500);

    const restore = instrumentNodeNetwork(sendEvent, addBreadcrumb, undefined, undefined, httpModule as any, httpsModule as any);

    const http = httpModule as any;
    http.request({ path: '/ok' }).end();
    httpsModule.request({ path: '/err' }).end();

    await new Promise((r) => setTimeout(r, 20));
    restore();

    const okEvt = events.find((e) => e.type === 'network' && e.network?.status === 200);
    const errEvt = events.find((e) => e.type === 'network' && e.network?.status === 500);
    expect(okEvt?.level).toBe('info');
    expect(errEvt?.level).toBe('error');
  });

  it('keeps patches active while any bridge remains and broadcasts to all sinks', async () => {
    const makeHttp = (status: number) => ({
      request: (_opts: any, cb?: any) => {
        const req: any = new (require('events').EventEmitter)();
        req.write = () => {};
        req.end = () => {
          const res: any = new (require('events').EventEmitter)();
          res.statusCode = status;
          res.on = res.addListener.bind(res);
          cb && cb(res);
          res.emit('data', Buffer.from('x'));
          res.emit('end');
        };
        req.on = req.addListener.bind(req);
        setTimeout(() => {
          req.emit('response', { statusCode: status, on: (ev: string, fn: any) => { if (ev === 'data') fn(Buffer.from('x')); if (ev === 'end') fn(); } });
        }, 0);
        return req;
      },
      get: function (...args: any[]) { const r = this.request(...args); r.end(); return r; },
    });

    const httpModule = makeHttp(200);
    const httpsModule = makeHttp(200);
    const originalRequest = httpModule.request;

    const bridgeA = makeSendEvent();
    const crumbsA = makeAddBreadcrumb();
    const bridgeB = makeSendEvent();
    const crumbsB = makeAddBreadcrumb();

    const restoreA = instrumentNodeNetwork(bridgeA.sendEvent, crumbsA.addBreadcrumb, undefined, undefined, httpModule as any, httpsModule as any);
    const restoreB = instrumentNodeNetwork(bridgeB.sendEvent, crumbsB.addBreadcrumb, undefined, undefined, httpModule as any, httpsModule as any);

    httpModule.request({ path: '/one' }).end();
    await new Promise((r) => setTimeout(r, 20));

    expect(bridgeA.events.find((e) => e.network?.status === 200)).toBeTruthy();
    expect(bridgeB.events.find((e) => e.network?.status === 200)).toBeTruthy();

    const countA = bridgeA.events.length;
    const countB = bridgeB.events.length;

    restoreA();

    httpModule.request({ path: '/two' }).end();
    await new Promise((r) => setTimeout(r, 20));

    expect(bridgeA.events.length).toBe(countA);
    expect(bridgeB.events.length).toBe(countB + 1);

    restoreB();

    httpModule.request({ path: '/three' }).end();
    await new Promise((r) => setTimeout(r, 20));

    expect(httpModule.request).toBe(originalRequest);
    expect(bridgeB.events.length).toBe(countB + 1);
  });

  // Control path is covered in browser capture tests; node transport validated via network here.
});
