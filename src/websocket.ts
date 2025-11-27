import type { BridgeEvent } from './types';
import { detectPlatform } from './platform';

export class BridgeWebSocket {
  private ws: WebSocket | any = null;
  private readonly url: string;
  private readonly secret: string;
  private reconnectTimeout: any = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor(url: string, secret: string) {
    this.url = url;
    this.secret = secret;
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
          // Always send auth message so the host can validate secrets uniformly
          this.send({ type: 'auth', secret: this.secret } as any);
          resolve();
        };

        this.ws.onerror = (error: any) => {
          console.error('[code-bridge] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          this.scheduleReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  send(event: BridgeEvent): void {
    if (this.ws?.readyState === 1) { // OPEN
      this.ws.send(JSON.stringify(event));
    }
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
}
