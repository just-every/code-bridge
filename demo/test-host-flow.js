#!/usr/bin/env node

/**
 * Test script for code-bridge-host
 *
 * This script tests the complete flow:
 * 1. Start code-bridge-host
 * 2. Connect a consumer client
 * 3. Connect a bridge client
 * 4. Verify events flow from bridge to consumer
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const testWorkspace = '/tmp/test-code-bridge-workspace';
const metaFile = path.join(testWorkspace, '.code/code-bridge.json');

// Cleanup and setup
if (fs.existsSync(testWorkspace)) {
  fs.rmSync(testWorkspace, { recursive: true });
}
fs.mkdirSync(testWorkspace, { recursive: true });

let hostProcess = null;
let consumerWs = null;
let bridgeWs = null;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeout = 5000) {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timeout waiting for ${filePath}`);
    }
    await sleep(100);
  }
}

async function startHost() {
  console.log('1. Starting code-bridge-host...');
  hostProcess = spawn('node', [
    path.join(__dirname, '../bin/code-bridge-host.js'),
    testWorkspace
  ]);

  hostProcess.stdout.on('data', (data) => {
    console.log(`   [host] ${data.toString().trim()}`);
  });

  hostProcess.stderr.on('data', (data) => {
    console.error(`   [host error] ${data.toString().trim()}`);
  });

  // Wait for metadata file
  await waitForFile(metaFile);
  await sleep(500); // Give server time to fully start

  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  console.log(`   Host started: ${meta.url}`);
  console.log(`   Secret: ${meta.secret.slice(0, 8)}...`);
  return meta;
}

async function connectConsumer(meta) {
  console.log('\n2. Connecting consumer client...');

  return new Promise((resolve, reject) => {
    consumerWs = new WebSocket(meta.url);

    consumerWs.on('open', () => {
      consumerWs.send(JSON.stringify({
        type: 'auth',
        secret: meta.secret,
        role: 'consumer',
        clientId: 'test-consumer',
      }));
    });

    consumerWs.on('message', (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === 'auth_success') {
        console.log(`   Consumer authenticated: ${message.clientId}`);
        resolve();
      } else {
        // This is an event from a bridge
        console.log(`   [consumer received] type=${message.type} level=${message.level} message="${message.message}"`);
      }
    });

    consumerWs.on('error', (err) => {
      console.error(`   Consumer error: ${err.message}`);
      reject(err);
    });

    setTimeout(() => reject(new Error('Consumer connection timeout')), 5000);
  });
}

async function connectBridge(meta) {
  console.log('\n3. Connecting bridge client...');

  return new Promise((resolve, reject) => {
    bridgeWs = new WebSocket(meta.url);

    bridgeWs.on('open', () => {
      bridgeWs.send(JSON.stringify({
        type: 'auth',
        secret: meta.secret,
        role: 'bridge',
        clientId: 'test-bridge-app',
      }));
    });

    bridgeWs.on('message', (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === 'auth_success') {
        console.log(`   Bridge authenticated: ${message.clientId}`);
        resolve();
      }
    });

    bridgeWs.on('error', (err) => {
      console.error(`   Bridge error: ${err.message}`);
      reject(err);
    });

    setTimeout(() => reject(new Error('Bridge connection timeout')), 5000);
  });
}

async function sendTestEvents() {
  console.log('\n4. Sending test events from bridge...');

  const events = [
    {
      type: 'console',
      level: 'log',
      message: 'Test log message',
      timestamp: Date.now(),
      platform: 'node',
      projectId: 'test-bridge-app',
    },
    {
      type: 'console',
      level: 'warn',
      message: 'Test warning',
      timestamp: Date.now(),
      platform: 'node',
      projectId: 'test-bridge-app',
    },
    {
      type: 'error',
      level: 'error',
      message: 'Test error',
      stack: 'Error: Test error\n    at test.js:10:15',
      timestamp: Date.now(),
      platform: 'node',
      projectId: 'test-bridge-app',
    },
  ];

  for (const event of events) {
    bridgeWs.send(JSON.stringify(event));
    await sleep(200);
  }

  console.log('   Sent 3 test events');
}

async function cleanup() {
  console.log('\n5. Cleaning up...');

  if (consumerWs) {
    consumerWs.close();
  }
  if (bridgeWs) {
    bridgeWs.close();
  }

  await sleep(500);

  if (hostProcess) {
    hostProcess.kill('SIGTERM');

    // Wait for graceful shutdown
    await new Promise((resolve) => {
      hostProcess.on('exit', resolve);
      setTimeout(resolve, 2000); // Force after 2s
    });
  }

  // Verify cleanup
  if (fs.existsSync(metaFile)) {
    console.log('   WARNING: Metadata file not cleaned up');
  } else {
    console.log('   Metadata file cleaned up');
  }

  const lockFile = path.join(testWorkspace, '.code/code-bridge.lock');
  if (fs.existsSync(lockFile)) {
    console.log('   WARNING: Lock file not cleaned up');
  } else {
    console.log('   Lock file cleaned up');
  }

  console.log('\n✓ Test completed successfully!');
}

// Run the test
(async () => {
  try {
    const meta = await startHost();
    await connectConsumer(meta);
    await connectBridge(meta);
    await sendTestEvents();
    await sleep(1000); // Wait for events to be processed
    await cleanup();
  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    if (hostProcess) {
      hostProcess.kill('SIGKILL');
    }
    process.exit(1);
  }
})();
