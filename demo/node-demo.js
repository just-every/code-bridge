// Node.js demo for @just-every/code-bridge
// Run with: node demo/node-demo.js
// (enabled: true is set explicitly in the demo)

const { startBridge } = require('../dist/index.js');

console.log('Starting Code Bridge Node.js demo...\n');

// Start the bridge
const bridge = startBridge({
  url: 'ws://localhost:9876',
  secret: 'dev-secret',
  projectId: 'node-demo',
  enabled: true, // Force enable for demo
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

// Disconnect after tests
setTimeout(() => {
  console.log('\nDemo complete. Disconnecting...');
  bridge.disconnect();
  console.log('Disconnected.');
  process.exit(0);
}, 5000);
