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
          // fallthrough
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
        // ignore
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', handler as any);
    };

    ws.on('message', handler as any);
  });
}

describe('host screenshot routing', () => {
  it('forwards screenshot events to subscribed consumers', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-host-shot-'));
    const host = spawn(process.execPath, [HOST_BIN, tmpDir, '--port=0'], { stdio: 'ignore' });
    const metaPath = path.join(tmpDir, '.code', 'code-bridge.json');

    let bridge: WebSocket | null = null;
    let consumer: WebSocket | null = null;
    try {
      const meta = await waitForJson<{ url: string; secret: string }>(metaPath, 6000);

      consumer = new WebSocket(meta.url);
      await new Promise((res) => consumer!.on('open', res));
      consumer.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'consumer', clientId: 'c-shot' }));
      await waitForMessage(consumer, (m) => (m.type === 'auth_success' ? true : undefined));
      consumer.send(JSON.stringify({ type: 'subscribe', levels: ['info'], capabilities: ['screenshot'] }));
      await waitForMessage(consumer, (m) => (m.type === 'subscribe_ack' ? true : undefined));

      bridge = new WebSocket(meta.url);
      await new Promise((res) => bridge!.on('open', res));
      bridge.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'bridge', clientId: 'b-shot' }));
      await waitForMessage(bridge, (m) => (m.type === 'auth_success' ? true : undefined));
      bridge.send(JSON.stringify({
        type: 'hello',
        capabilities: ['screenshot', 'control'],
        protocol: 2,
        platform: 'web',
        projectId: 'test',
      }));
      await waitForMessage(bridge, (m) => (m.type === 'hello_ack' ? true : undefined));

      const shotPromise = waitForMessage(consumer, (m) => (m.type === 'screenshot' ? m : undefined), 6000);

      bridge.send(JSON.stringify({
        type: 'screenshot',
        mime: 'image/png',
        data: 'aGVsbG8=',
        message: 'Screenshot: /',
        url: 'http://localhost:5173/',
        route: '/',
        platform: 'web',
        timestamp: Date.now(),
        projectId: 'test',
        level: 'info',
      }));

      const shot = await shotPromise;
      expect(shot.mime).toBe('image/png');
      expect(shot.data).toBe('aGVsbG8=');
    } finally {
      bridge?.close();
      consumer?.close();
      host.kill('SIGTERM');
      await new Promise((res) => host.once('exit', res));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
