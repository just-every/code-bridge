import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type {
  BridgeEvent,
  ControlResultMessage,
  SubscribeMessage,
} from '../types';
import type { BridgeMeta } from './types';

type ControlResolver = {
  resolve: (msg: ControlResultMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export interface ConsumerEvents {
  'bridge-event': (event: BridgeEvent) => void;
  'control-result': (result: ControlResultMessage) => void;
  'subscribe-ack': (msg: any) => void;
}

export class HostConsumer extends EventEmitter {
  private ws: WebSocket | null = null;
  private meta: BridgeMeta;
  private clientId: string;
  private pendingControls = new Map<string, ControlResolver>();
  private debug: boolean;

  constructor(meta: BridgeMeta, clientId: string, debug = false) {
    super();
    this.meta = meta;
    this.clientId = clientId;
    this.debug = debug;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.meta.url);

      const fail = (err: Error) => {
        this.log(`WS error: ${err.message}`);
        reject(err);
      };

      this.ws.once('error', fail);

      this.ws.on('open', () => {
        this.log(`Connected to host ${this.meta.url}`);
        this.send({ type: 'auth', secret: this.meta.secret, role: 'consumer', clientId: this.clientId });
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString()));

      const timeout = setTimeout(() => reject(new Error('Timed out waiting for auth_success')), 5000);

      const onAuth = (msg: any) => {
        if (msg.type === 'auth_success') {
          clearTimeout(timeout);
          this.ws?.off('message', authListener as any);
          resolve();
        }
      };

      const authListener = (data: WebSocket.RawData) => {
        try { onAuth(JSON.parse(data.toString())); } catch { /* ignore */ }
      };

      this.ws.on('message', authListener as any);
    });
  }

  async subscribe(message: SubscribeMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for subscribe_ack')), 4000);
      const listener = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'subscribe_ack') {
            clearTimeout(timer);
            this.ws?.off('message', listener as any);
            this.emit('subscribe-ack', msg);
            resolve();
          }
        } catch {
          // ignore
        }
      };
      this.ws.on('message', listener as any);
      this.send(message);
    });
  }

  async sendControl(id: string, action: string, args?: any, timeoutMs = 10000): Promise<ControlResultMessage> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingControls.delete(id);
        reject(new Error('Control request timed out'));
      }, timeoutMs);

      this.pendingControls.set(id, { resolve, reject, timer });
      this.send({ type: 'control_request', id, action, args });
    });
  }

  close(): void {
    this.pendingControls.forEach((entry) => clearTimeout(entry.timer));
    this.pendingControls.clear();
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'control_result') {
      const pending = this.pendingControls.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingControls.delete(msg.id);
        if (msg.ok) pending.resolve(msg);
        else pending.reject(new Error(msg.error?.message || 'control failed'));
      }
      this.emit('control-result', msg as ControlResultMessage);
      return;
    }

    if (msg.type === 'rate_limit_notice') return; // ignore

    if (msg.type === 'auth_success' || msg.type === 'subscribe_ack' || msg.type === 'control_forwarded') {
      // handled elsewhere when awaited
      return;
    }

    if (msg.type) {
      // Bridge event passthrough
      this.emit('bridge-event', msg as BridgeEvent);
    }
  }

  private send(payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private log(msg: string) {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error(`[mcp-consumer] ${msg}`);
    }
  }
}
