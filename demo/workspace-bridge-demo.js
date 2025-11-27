#!/usr/bin/env node
// Dev-only demo: reads .code/code-bridge.json from a workspace running `code`
// and streams a few test events into the active Code session.
// Run: node demo/workspace-bridge-demo.js /path/to/workspace

const fs = require('fs');
const path = require('path');

// Use the built output so this script works after `npm run build`.
const { startBridge } = require('../dist/index.js');

const workspace = process.argv[2] || process.env.CODE_WORKSPACE || process.cwd();
const metaPath = path.join(workspace, '.code', 'code-bridge.json');

function readMeta(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[code-bridge demo] Cannot read metadata at ${file}:`, err.message);
    return null;
  }
}

const meta = readMeta(metaPath);
if (!meta) {
  process.exit(1);
}

const url = meta.url || meta.host || (meta.port ? `ws://127.0.0.1:${meta.port}` : null);
const secret = meta.secret;

if (!url || !secret) {
  console.error('[code-bridge demo] Missing url/host or secret in code-bridge metadata:', metaPath);
  process.exit(1);
}

console.log('[code-bridge demo] Using workspace:', workspace);
console.log('[code-bridge demo] Connecting to', url);

const bridge = startBridge({
  url,
  secret,
  projectId: path.basename(workspace),
  enabled: true, // force on for demo
});

console.log('[code-bridge demo] Bridge started; emitting test events...');

console.log('[code-bridge demo] log event');
console.info('[code-bridge demo] info event');
console.warn('[code-bridge demo] warn event');
console.error('[code-bridge demo] error event');

setTimeout(() => {
  Promise.reject(new Error('Intentional demo unhandled rejection'));
}, 500);

setTimeout(() => {
  throw new Error('Intentional demo uncaught error');
}, 1000);

setTimeout(() => {
  console.log('[code-bridge demo] Done. Disconnecting.');
  bridge.disconnect();
  process.exit(0);
}, 3000);
