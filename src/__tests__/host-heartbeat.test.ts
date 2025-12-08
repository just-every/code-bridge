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
          // ignore and retry
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

describe('host heartbeat', () => {
  it('replies with pong when a bridge sends ping', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-host-'));
    const host = spawn(process.execPath, [HOST_BIN, tmpDir, '--port=0'], { stdio: 'ignore' });
    const metaPath = path.join(tmpDir, '.code', 'code-bridge.json');

    let bridge: WebSocket | null = null;
    try {
      const meta = await waitForJson<{ url: string; secret: string }>(metaPath, 6000);

      bridge = new WebSocket(meta.url);
      await new Promise((res) => bridge!.on('open', res));

      bridge.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'bridge', clientId: 'hb-bridge' }));
      await waitForMessage(bridge, (m) => (m.type === 'auth_success' ? true : undefined));

      bridge.send(JSON.stringify({ type: 'ping' }));

      const pong = await waitForMessage(bridge, (m) => (m.type === 'pong' ? m : undefined));
      expect(pong.type).toBe('pong');
    } finally {
      bridge?.close();
      host.kill('SIGTERM');
      await new Promise((res) => host.once('exit', res));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
