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
  private reconnectTimeout: any = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private helloSent = false;
  private capabilities: BridgeCapability[] = [];
  private platform: Platform;
  private projectId?: string;
  private controlHandler: ((msg: ControlRequestMessage) => Promise<any> | any) | null = null;

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

          // Send auth message first
          this.sendRaw({ type: 'auth', secret: this.secret, role: 'bridge' });

          // Then send hello frame with capabilities
          this.sendHello();

          resolve();
        };

        this.ws.onmessage = (evt: any) => {
          this.handleIncoming(evt.data);
        };

        this.ws.onerror = (error: any) => {
          console.error('[code-bridge] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
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
    if (this.ws?.readyState === 1) { // OPEN
      this.ws.send(JSON.stringify(event));
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
}
