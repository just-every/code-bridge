#!/usr/bin/env node

// Control channel round-trip demo on a clean workspace/port.
// 1) Spawns code-bridge-host in a temp workspace
// 2) Connects a Node bridge with enableControl
// 3) Connects a consumer and issues control_request -> expects control_result

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { startBridge } = require('../dist');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-control-'));
const metaFile = path.join(tmp, '.code', 'code-bridge.json');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startHost() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, '../bin/code-bridge-host.js'), tmp], {
      stdio: 'inherit',
    });
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (fs.existsSync(metaFile)) {
        clearInterval(timer);
        resolve({ child, meta: JSON.parse(fs.readFileSync(metaFile, 'utf8')) });
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for host metadata'));
      }
    }, 100);
  });
}

async function run() {
  console.log('Starting control round-trip demo...');
  const { child, meta } = await startHost();
  console.log(`Host ready at ${meta.url}`);

  const bridge = startBridge({
    url: meta.url,
    secret: meta.secret,
    projectId: 'control-demo',
    enabled: true,
    enableControl: true,
  });

  await sleep(300); // allow hello/auth

  const reqId = 'ctl-' + Date.now();
  const consumer = new WebSocket(meta.url);

  consumer.on('open', () => {
    consumer.send(JSON.stringify({ type: 'auth', secret: meta.secret, role: 'consumer', clientId: 'control-demo-consumer' }));
  });

  consumer.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'auth_success') {
      consumer.send(JSON.stringify({ type: 'subscribe', levels: ['trace'], capabilities: ['control'] }));
      setTimeout(() => {
        consumer.send(JSON.stringify({ type: 'control_request', id: reqId, action: 'eval', code: '21/3', expectResult: true }));
      }, 100);
    } else if (msg.type === 'control_result' && msg.id === reqId) {
      console.log('Received control_result:', msg);
      cleanup();
    }
  });

  const cleanup = () => {
    try { consumer.close(); } catch (_) {}
    try { bridge.disconnect(); } catch (_) {}
    try { child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => process.exit(0), 200);
  };

  setTimeout(() => {
    console.error('Timeout waiting for control_result');
    cleanup();
  }, 5000);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
