// Minimal WS host for Java SDK tests.
const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT || 9890);
const secret = process.env.SECRET || 'dev-secret';
const autoPong = process.env.AUTO_PONG !== 'false';
const sendControl = process.env.SEND_CONTROL === 'true';
const dropPong = process.env.DROP_PONG === 'true';

const wss = new WebSocketServer({ port });

function log(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

wss.on('connection', (ws, req) => {
  log({ event: 'open', headers: req.headers });
  let authed = false;

  ws.on('message', (data) => {
    let msg = {};
    try { msg = JSON.parse(data.toString()); } catch {}
    log({ event: 'recv', msg });
    switch (msg.type) {
      case 'auth':
        if (msg.secret !== secret) {
          ws.close(4001, 'invalid secret');
          return;
        }
        authed = true;
        setTimeout(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'auth_success', role: msg.role || 'bridge', clientId: 'client' }));
          }
        }, 50);
        break;
      case 'ping':
        if (autoPong && !dropPong) ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'control_result':
        log({ event: 'control_result', msg });
        break;
      default:
        break;
    }
  });

  if (sendControl) {
    setTimeout(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'control_request', id: 'c1', action: 'echo', args: { value: 1 } }));
      }
    }, 200);
  }

  // Server initiated pings to keep traffic moving
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 10000);

  ws.on('close', () => clearInterval(interval));
});

log({ event: 'listening', port });
