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

describe('host control routing', () => {
  it('returns control results to the originating bridge', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-host-'));
    const host = spawn(process.execPath, [HOST_BIN, tmpDir, '--port=0'], { stdio: 'ignore' });
    const metaPath = path.join(tmpDir, '.code', 'code-bridge.json');

    let bridge: WebSocket | null = null;
    let consumer: WebSocket | null = null;
    try {
      const meta = await waitForJson<{ url: string; secret: string }>(metaPath, 6000);

      consumer = new WebSocket(meta.url);
      await new Promise((res) => consumer!.on('open', res));
      consumer.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'consumer', clientId: 'c1' }));
      await waitForMessage(consumer, (m) => (m.type === 'auth_success' ? true : undefined));
      consumer.send(JSON.stringify({ type: 'subscribe', levels: ['info'], capabilities: ['control'] }));
      await waitForMessage(consumer, (m) => (m.type === 'subscribe_ack' ? true : undefined));

      bridge = new WebSocket(meta.url);
      await new Promise((res) => bridge!.on('open', res));
      bridge.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'bridge', clientId: 'b1' }));
      await waitForMessage(bridge, (m) => (m.type === 'auth_success' ? true : undefined));
      bridge.send(JSON.stringify({
        type: 'hello',
        capabilities: ['control'],
        protocol: 2,
        platform: 'node',
        projectId: 'test',
      }));
      await waitForMessage(bridge, (m) => (m.type === 'hello_ack' ? true : undefined));

      // Consumer replies to control requests
      consumer.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'control_request') {
          consumer!.send(JSON.stringify({ type: 'control_result', id: msg.id, ok: true, result: 'pong' }));
        }
      });

      const resultPromise = waitForMessage(bridge, (m) => (m.type === 'control_result' && m.ok ? m : undefined), 6000);

      bridge.send(JSON.stringify({ type: 'control_request', id: 'req-1', action: 'ping' }));

      const result = await resultPromise;
      expect(result.result).toBe('pong');
    } finally {
      bridge?.close();
      consumer?.close();
      host.kill('SIGTERM');
      await new Promise((res) => host.once('exit', res));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
