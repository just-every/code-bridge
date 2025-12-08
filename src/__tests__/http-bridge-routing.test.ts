import { describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const HOST_BIN = path.resolve(__dirname, '../../bin/code-bridge-host.js');

function waitForJson<T>(file: string, timeoutMs = 4000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(file)) {
        try {
          const contents = fs.readFileSync(file, 'utf8');
          const parsed = JSON.parse(contents) as T;
          return resolve(parsed);
        } catch {
          // fallthrough and retry
        }
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for JSON file ${file}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function waitForMessage<T>(ws: WebSocket, predicate: (msg: any) => T | undefined, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for message'));
    }, timeoutMs);

    const handler = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        const match = predicate(msg);
        if (match !== undefined) {
          cleanup();
          resolve(match);
        }
      } catch {
        // ignore malformed
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', handler as any);
    };

    ws.on('message', handler as any);
  });
}

describe('http bridge routing', () => {
  it('delivers events from HTTP bridge to subscribed consumer', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-host-http-'));
    const host = spawn(process.execPath, [HOST_BIN, tmpDir, '--port=0'], { stdio: 'ignore' });
    const metaPath = path.join(tmpDir, '.code', 'code-bridge.json');

    let consumer: WebSocket | null = null;
    let lastMessage: any = null;
    try {
      const meta = await waitForJson<{ url: string; secret: string; port: number }>(metaPath, 6000);
      const httpBase = meta.url.replace('ws://', 'http://');

      consumer = new WebSocket(meta.url);
      await new Promise((res) => consumer!.on('open', res));
      consumer.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          // eslint-disable-next-line no-console
          console.log('consumer received', parsed);
          lastMessage = parsed;
        } catch {
          // ignore
        }
      });
      consumer.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'consumer', clientId: 'c-http' }));
      await waitForMessage(consumer, (m) => (m.type === 'auth_success' ? true : undefined));
      consumer.send(JSON.stringify({ type: 'subscribe', levels: ['info'] }));
      await waitForMessage(consumer, (m) => (m.type === 'subscribe_ack' ? true : undefined));
      await new Promise((res) => setTimeout(res, 50));

      // Connect HTTP bridge
      const connectResp = await fetch(`${httpBase.replace('ws:', 'http:')}/bridge/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: meta.secret }),
      });
      expect(connectResp.ok).toBe(true);
      const connectJson = await connectResp.json();
      const sessionId = connectJson.sessionId as string;

      const helloResp = await fetch(`${httpBase}/bridge/hello`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          capabilities: ['console'],
          platform: 'roblox',
          projectId: 'test-http',
          protocol: 2,
        }),
      });
      expect(helloResp.ok).toBe(true);

      const eventsResp = await fetch(`${httpBase}/bridge/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          events: [
            {
              type: 'console',
              level: 'info',
              message: 'hello-http-bridge',
              timestamp: Date.now(),
              platform: 'roblox',
            },
          ],
        }),
      });
      expect(eventsResp.ok).toBe(true);

      const started = Date.now();
      while (!lastMessage || lastMessage.message !== 'hello-http-bridge') {
        if (Date.now() - started > 6000) {
          throw new Error('Timed out waiting for message');
        }
        await new Promise((res) => setTimeout(res, 50));
      }
      expect(lastMessage.message).toBe('hello-http-bridge');
      expect(lastMessage.platform).toBe('roblox');
    } finally {
      consumer?.close();
      host.kill('SIGTERM');
      await new Promise((res) => host.once('exit', res));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20000);
});
