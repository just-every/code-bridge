import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../../tools/protocol-test-server';

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe('protocol test server harness', () => {
  let server: { port: number; close: () => Promise<void> } | null = null;

  beforeAll(async () => {
    server = await createServer({ port: 0, pingIntervalMs: 50 });
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  it('responds to auth and hello and echoes', async () => {
    const ws = new WebSocket(`ws://localhost:${server!.port}`);

    const messages: any[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

    await new Promise((res) => ws.on('open', res));

    ws.send(JSON.stringify({ type: 'auth', secret: 's', role: 'bridge', clientId: 'test-client' }));
    ws.send(JSON.stringify({ type: 'hello', capabilities: ['console'], platform: 'node', protocol: 2 }));
    ws.send(JSON.stringify({ type: 'ping' }));

    await wait(20);

    expect(messages.find((m) => m.type === 'auth_success')).toBeTruthy();
    expect(messages.find((m) => m.type === 'hello_ack')).toBeTruthy();
    expect(messages.find((m) => m.type === 'pong')).toBeTruthy();

    ws.close();
  });

  it('sends server-initiated pings that clients can observe', async () => {
    const ws = new WebSocket(`ws://localhost:${server!.port}`);
    const messages: any[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

    await new Promise((res) => ws.on('open', res));

    // wait long enough for a server ping
    await wait(120);

    expect(messages.some((m) => m.type === 'ping')).toBe(true);
    ws.close();
  });
});
