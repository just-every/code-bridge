import type {
  BridgeEvent,
  BridgeCapability,
  HelloMessage,
  Platform,
  ControlRequestMessage,
  ControlResultMessage,
  ProtocolMessage,
} from './types';
import { detectPlatform } from './platform';

export class BridgeWebSocket {
  private ws: WebSocket | any = null;
  private readonly url: string;
  private readonly secret: string;
  // reconnect / heartbeat
  private reconnectTimeout: any = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private heartbeatInterval: any = null;
  private heartbeatTimeout: any = null;
  private readonly heartbeatIntervalMs = 15_000;
  // Keep timeout comfortably larger than interval to avoid false disconnects when pongs arrive on time.
  private readonly heartbeatTimeoutMs = 30_000;
  private helloSent = false;
  private capabilities: BridgeCapability[] = [];
  private platform: Platform;
  private projectId?: string;
  private controlHandler: ((msg: ControlRequestMessage) => Promise<any> | any) | null = null;
  // buffer
  private buffer: BridgeEvent[] = [];
  private readonly bufferLimit = 200;
  private dropped = 0;

  constructor(url: string, secret: string, capabilities: BridgeCapability[], platform: Platform, projectId?: string) {
    this.url = url;
    this.secret = secret;
    this.capabilities = capabilities;
    this.platform = platform;
    this.projectId = projectId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const platform = detectPlatform();

        if (platform === 'node') {
          // In Node.js, use the 'ws' package
          const { WebSocket: NodeWS } = require('ws');
          this.ws = new NodeWS(this.url, {
            headers: {
              'X-Bridge-Secret': this.secret,
            },
          });
        } else {
          // In web/React Native, use native WebSocket
          this.ws = new WebSocket(this.url);
        }

        this.ws.onopen = () => {
          this.reconnectDelay = 1000;
          this.helloSent = false;

          this.startHeartbeat();

          // Send auth message first
          this.sendRaw({ type: 'auth', secret: this.secret, role: 'bridge' });

          // Then send hello frame with capabilities
          this.sendHello();

          this.flushBuffer();

          resolve();
        };

        this.ws.onmessage = (evt: any) => {
          this.handleIncoming(evt.data);
        };

        this.ws.onerror = (error: any) => {
          console.error('[code-bridge] WebSocket error:', error);
          this.stopHeartbeat();
          reject(error);
        };

        this.ws.onclose = () => {
          this.stopHeartbeat();
          this.helloSent = false;
          this.scheduleReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private sendHello(): void {
    if (this.helloSent) return;

    const helloMessage: HelloMessage = {
      type: 'hello',
      capabilities: this.capabilities,
      platform: this.platform,
      projectId: this.projectId,
      protocol: 2,
    };

    // Try to get current URL/route for web/RN
    if (this.platform === 'web' && typeof window !== 'undefined') {
      helloMessage.url = window.location.href;
      helloMessage.route = window.location.pathname;
    }

    this.sendRaw(helloMessage as any);
    this.helloSent = true;
  }

  send(event: BridgeEvent): void {
    const safe = this.validateAndRedact(event);
    if (!safe) return;
    if (this.ws?.readyState === 1) { // OPEN
      this.ws.send(JSON.stringify(safe));
    } else {
      this.enqueue(safe);
    }
  }

  sendControlResult(message: ControlResultMessage): void {
    this.sendRaw(message);
  }

  sendRaw(obj: unknown): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  setControlHandler(handler: (msg: ControlRequestMessage) => Promise<any> | any) {
    this.controlHandler = handler;
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect().catch(() => {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay
        );
      });
    }, this.reconnectDelay);
  }

  private handleIncoming(raw: string): void {
    try {
      const msg: ProtocolMessage = JSON.parse(raw);
      if (msg.type === 'pong') {
        this.resetHeartbeatTimeout();
        return;
      }
      if (msg.type === 'ping') {
        this.sendRaw({ type: 'pong' });
        return;
      }
      if (msg.type === 'control_request') {
        if (!this.controlHandler) return;
        Promise.resolve()
          .then(() => this.controlHandler ? this.controlHandler(msg as ControlRequestMessage) : undefined)
          .then((result) => {
            const response: ControlResultMessage = {
              type: 'control_result',
              id: msg.id,
              ok: true,
              result,
            };
            this.sendControlResult(response);
          })
          .catch((err: any) => {
            const response: ControlResultMessage = {
              type: 'control_result',
              id: msg.id,
              ok: false,
              error: { message: err?.message || String(err), stack: err?.stack },
            };
            this.sendControlResult(response);
          });
      }
    } catch {
      // ignore malformed
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    const sendPing = () => {
      this.sendRaw({ type: 'ping' });
      this.setHeartbeatTimeout();
    };

    this.heartbeatInterval = setInterval(sendPing, this.heartbeatIntervalMs);
    // Do not start the timeout until after the first ping is sent; otherwise we
    // could close the socket before any heartbeat is transmitted/acknowledged.
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
  }

  private setHeartbeatTimeout() {
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = setTimeout(() => {
      if (this.ws) {
        try { this.ws.close(); } catch { /* ignore */ }
      }
    }, this.heartbeatTimeoutMs);
  }

  private resetHeartbeatTimeout() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.setHeartbeatTimeout();
    }
  }

  private enqueue(ev: BridgeEvent) {
    if (this.buffer.length >= this.bufferLimit) {
      this.buffer.shift();
      this.dropped += 1;
    }
    this.buffer.push(ev);
  }

  private flushBuffer() {
    if (this.ws?.readyState !== 1) return;
    while (this.buffer.length) {
      const ev = this.buffer.shift()!;
      this.ws.send(JSON.stringify(ev));
    }
    if (this.dropped > 0) {
      this.ws.send(JSON.stringify({ type: 'info', level: 'info', message: `bridge buffered drop count=${this.dropped}` }));
      this.dropped = 0;
    }
  }

  private validateAndRedact(event: BridgeEvent): BridgeEvent | null {
    if (!event || typeof event !== 'object') return null;
    if (!event.type || typeof event.type !== 'string') return null;
    const clone: any = { ...event };
    if (clone.message && typeof clone.message === 'string' && clone.message.length > 4000) {
      clone.message = clone.message.slice(0, 4000) + '…[truncated]';
    }
    const redactKeys = ['token', 'secret', 'password'];
    if (clone.args && Array.isArray(clone.args)) {
      clone.args = clone.args.map((arg: any) => this.redactObject(arg, redactKeys));
    }
    if (clone.breadcrumbs && Array.isArray(clone.breadcrumbs)) {
      clone.breadcrumbs = clone.breadcrumbs.map((b: any) => this.redactObject(b, redactKeys));
    }
    return clone as BridgeEvent;
  }

  private redactObject(obj: any, keys: string[]): any {
    if (!obj || typeof obj !== 'object') return obj;
    const out: any = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (keys.some((rk) => k.toLowerCase().includes(rk))) {
        out[k] = '[redacted]';
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
