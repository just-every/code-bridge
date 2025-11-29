// Node.js demo for @just-every/code-bridge
// Run with: node demo/node-demo.js
// (enabled: true is set explicitly in the demo)

const fs = require('fs');
const path = require('path');
const { startBridge } = require('../dist/index.js');

function loadHostMeta() {
  const metaPath = path.join(process.cwd(), '.code', 'code-bridge.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.url && meta.secret) return { url: meta.url, secret: meta.secret };
    } catch (_) {}
  }
  return { url: 'ws://localhost:9876', secret: 'dev-secret' };
}

const { url, secret } = loadHostMeta();

console.log('Using host', url, 'secret', secret.slice(0, 6) + '...');

console.log('Starting Code Bridge Node.js demo...\n');

// Start the bridge
const bridge = startBridge({
  url,
  secret,
  projectId: 'node-demo',
  enabled: true, // Force enable for demo
  enableNetwork: true,
  enableControl: true,
  enableScreenshot: true,
  screenshotProvider: async () => ({ mime: 'image/png', data: 'iVBORw0KGgo=' }),
});

console.log('Bridge connected. Testing event capture...\n');

// Test console logging
console.log('This is a log message');
console.info('This is an info message');
console.warn('This is a warning message');

// Test error logging
console.error('This is an error message');

// Test unhandled rejection
setTimeout(() => {
  Promise.reject(new Error('Test unhandled rejection'));
}, 1000);

// Test uncaught exception
setTimeout(() => {
  try {
    throw new Error('Test error with stack trace');
  } catch (err) {
    console.error('Caught error:', err);
  }
}, 2000);

// Test network (200 and 404)
setTimeout(async () => {
  try {
    const ok = await fetch('https://httpbin.org/status/200');
    console.log('fetch 200 status', ok.status);
    const notFound = await fetch('https://httpbin.org/status/404');
    console.log('fetch 404 status', notFound.status);
  } catch (e) {
    console.error('fetch error', e);
  }
}, 2500);

// Test screenshot send (stub)
setTimeout(() => {
  bridge.sendScreenshot({ mime: 'image/png', data: 'iVBORw0KGgo=' });
  console.log('Sent stub screenshot');
}, 3000);

// Disconnect after tests
setTimeout(() => {
  console.log('\nDemo complete. Disconnecting...');
  bridge.disconnect();
  console.log('Disconnected.');
  process.exit(0);
}, 5000);
