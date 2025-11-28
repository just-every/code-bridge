// Pageview demo for @just-every/code-bridge
// Tests the new hello frame and pageview tracking capabilities
// Run with: node demo/pageview-demo.js

const { startBridge } = require('../dist/index.js');

console.log('Starting Code Bridge Pageview demo...\n');

// Start the bridge with pageview tracking enabled
const bridge = startBridge({
  url: 'ws://localhost:9876',
  secret: 'dev-secret',
  projectId: 'pageview-demo',
  enabled: true,        // Force enable for demo
  enablePageview: true, // Enable pageview tracking
});

console.log('Bridge connected with pageview capability.\n');
console.log('The hello frame should include capabilities: ["error", "console", "pageview"]\n');

// Wait for connection to establish
setTimeout(() => {
  console.log('Testing pageview tracking...\n');

  // Test manual pageview tracking
  bridge.trackPageview({ route: '/home', url: 'https://example.com/home' });
  console.log('Tracked pageview: /home');

  bridge.trackPageview({ route: '/dashboard' });
  console.log('Tracked pageview: /dashboard');

  bridge.trackPageview({ url: 'https://example.com/profile' });
  console.log('Tracked pageview: (url only)');

  // Test a few console logs
  console.log('Also testing regular console capture');
  console.info('Info message after pageviews');

  // Clean exit after events are sent
  setTimeout(() => {
    console.log('\nDemo complete. Disconnecting...');
    bridge.disconnect();
    process.exit(0);
  }, 2000);
}, 1000);
