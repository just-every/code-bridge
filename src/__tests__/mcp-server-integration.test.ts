import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';
import { PassThrough } from 'stream';
import { startMcpServer } from '../mcp/server';

const HOST_BIN = path.resolve(__dirname, '../../bin/code-bridge-host.js');

function waitForJson<T>(file: string, timeoutMs = 6000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(file)) {
        try {
          const contents = fs.readFileSync(file, 'utf8');
          return resolve(JSON.parse(contents) as T);
        } catch {
          // retry
        }
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${file}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function jsonLine(message: unknown) {
  return `${JSON.stringify(message)}\n`;
}

describe('MCP server integration', () => {
  let tmpDir: string;
  let host: ReturnType<typeof spawn>;
  let bridge: WebSocket | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mcp-'));
  });

  afterEach(async () => {
    bridge?.close();
    if (host) {
      host.kill('SIGTERM');
      await new Promise((res) => host.once('exit', res));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('streams events and returns control results over MCP stdio', async () => {
    host = spawn(process.execPath, [HOST_BIN, tmpDir, '--port=0'], { stdio: 'ignore' });
    const meta = await waitForJson<{ url: string; secret: string }>(path.join(tmpDir, '.code', 'code-bridge.json'));

    // Bridge connects and responds to control requests
    bridge = new WebSocket(meta.url);
    await new Promise((res) => bridge!.once('open', res));
    bridge.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'bridge', clientId: 'b1' }));
    await waitForMessage(bridge, (m) => m.type === 'auth_success');
    bridge.send(JSON.stringify({
      type: 'hello',
      capabilities: ['control', 'error', 'console'],
      protocol: 2,
      platform: 'node',
      projectId: 'demo',
    }));
    await waitForMessage(bridge, (m) => m.type === 'hello_ack');

    bridge.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'control_request') {
        bridge!.send(JSON.stringify({ type: 'control_result', id: msg.id, ok: true, result: 'pong' }));
      }
    });

    // In-memory stdio wiring
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    const mcp = await startMcpServer({
      workspacePath: tmpDir,
      transport: new (require('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport)(clientToServer, serverToClient),
    });

    const responses: any[] = [];
    const notifications: any[] = [];

    serverToClient.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) responses.push(msg);
          else notifications.push(msg);
        } catch {
          // ignore
        }
      });
    });

    // initialize + list tools
    clientToServer.write(jsonLine({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }));
    clientToServer.write(jsonLine({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    clientToServer.write(jsonLine({ jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} }));

    await waitFor(() => responses.length >= 3);
    const listTools = responses.find((r) => r.id === 2);
    expect(listTools?.result?.tools?.some((t: any) => t.name === 'send_control')).toBe(true);
    const listResources = responses.find((r) => r.id === 4);
    expect(listResources?.result?.resources?.length).toBeGreaterThan(0);

    // Emit a bridge event and ensure notification arrives
    bridge.send(JSON.stringify({
      type: 'error',
      level: 'error',
      message: 'boom',
      timestamp: Date.now(),
      platform: 'node',
    }));

    await waitFor(() => notifications.some((n) => n.method === 'bridge/event'));
    const evt = notifications.find((n) => n.method === 'bridge/event');
    expect(evt?.params?.message).toBe('boom');

    // Read errors resource after event buffered
    clientToServer.write(jsonLine({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'bridge://events/errors' } }));

    await waitFor(() => responses.some((r) => r.id === 5));
    const errorsResource = responses.find((r) => r.id === 5);
    expect(JSON.stringify(errorsResource?.result || errorsResource?.error || {})).toContain('boom');

    // Control round-trip via tool call
    clientToServer.write(jsonLine({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'send_control', arguments: { action: 'ping' } },
    }));

    await waitFor(() => responses.some((r) => r.id === 3));
    const controlResult = responses.find((r) => r.id === 3);
    expect(JSON.stringify(controlResult?.result)).toContain('pong');

    await mcp.stop();
  }, 20000);
});

function waitForMessage<T>(ws: WebSocket, predicate: (msg: any) => T | undefined, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        const match = predicate(msg);
        if (match !== undefined) {
          clearTimeout(timer);
          ws.off('message', handler as any);
          resolve(match);
        }
      } catch {
        // ignore
      }
    };
    ws.on('message', handler as any);
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}
