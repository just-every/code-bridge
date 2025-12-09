#!/usr/bin/env node
// Minimal headless WebSocket server for protocol conformance tests.
// Intended for external SDKs to exercise auth/hello/heartbeat/control flows.

const http = require('http');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 9877;
const HEARTBEAT_INTERVAL_MS = 10_000;

function isString(v) { return typeof v === 'string' && v.length > 0; }
function isNumber(v) { return typeof v === 'number'; }
function isArray(v) { return Array.isArray(v); }

function validateAuth(msg) {
  return msg && msg.type === 'auth' && isString(msg.secret) && (msg.role === 'bridge' || msg.role === 'consumer');
}

function validateHello(msg) {
  return msg && msg.type === 'hello' && isArray(msg.capabilities) && msg.capabilities.length > 0 &&
    isString(msg.platform) && isNumber(msg.protocol) && msg.protocol >= 1;
}

function createServer(options = {}) {
  const {
    port = DEFAULT_PORT,
    secret = null,
    pingIntervalMs = HEARTBEAT_INTERVAL_MS,
    log = () => {},
  } = options;

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  const intervalHandles = new Set();

  wss.on('connection', (ws, request) => {
    // Optional header check for quick rejection
    if (secret) {
      const headerSecret = request.headers['x-bridge-secret'];
      if (headerSecret && headerSecret !== secret) {
        ws.close(4001, 'invalid secret');
        return;
      }
    }

    // Emit auth_success when we receive auth frame
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case 'auth': {
            if (!validateAuth(msg) || (secret && msg.secret !== secret)) {
              ws.close(4001, 'invalid auth');
              return;
            }
            ws.send(JSON.stringify({ type: 'auth_success', role: msg.role || 'bridge', clientId: msg.clientId || 'client' }));
            break;
          }
          case 'hello': {
            if (!validateHello(msg)) {
              ws.close(4002, 'invalid hello');
              return;
            }
            ws.send(JSON.stringify({ type: 'hello_ack', protocol: msg.protocol }));
            break;
          }
          case 'ping': {
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          }
          case 'control_request': {
            ws.send(JSON.stringify({ type: 'control_result', id: msg.id, ok: true, result: { echo: true } }));
            break;
          }
          default: {
            // Echo back for debugging
            ws.send(JSON.stringify({ type: 'echo', data: msg }));
          }
        }
      } catch {
        // ignore malformed
      }
    });

    // Server-initiated pings to exercise client pong handling
    if (pingIntervalMs > 0) {
      const handle = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, pingIntervalMs);
      intervalHandles.add(handle);
      ws.on('close', () => {
        clearInterval(handle);
        intervalHandles.delete(handle);
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      log(`protocol test server listening on ${actualPort}`);
      resolve({
        port: actualPort,
        close: () => new Promise((res) => {
          intervalHandles.forEach(clearInterval);
          intervalHandles.clear();
          wss.close(() => server.close(() => res()));
        }),
      });
    });
    server.on('error', reject);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.findIndex((arg) => arg.startsWith('--port'));
  const secretFlagIndex = argv.findIndex((arg) => arg.startsWith('--secret'));
  const port = portFlagIndex !== -1 ? Number(argv[portFlagIndex].split('=')[1]) : DEFAULT_PORT;
  const secret = secretFlagIndex !== -1 ? argv[secretFlagIndex].split('=')[1] : null;
  await createServer({ port, secret, log: console.log });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createServer };
