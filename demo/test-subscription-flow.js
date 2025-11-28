#!/usr/bin/env node

/**
 * Test script for the subscription and capability flow.
 * This demonstrates:
 * 1. Bridge sending hello with capabilities
 * 2. Consumer subscribing to specific levels and capabilities
 * 3. Filtering of events based on subscription
 */

const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const workspacePath = process.cwd();
const metaFile = path.join(workspacePath, '.code', 'code-bridge.json');

// Read connection metadata
if (!fs.existsSync(metaFile)) {
  console.error('code-bridge-host is not running. Start it with: npx code-bridge-host');
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const { url, secret } = metadata;

console.log('Testing subscription and capability flow...\n');

// Create bridge client
const bridge = new WebSocket(url);

bridge.on('open', () => {
  console.log('Bridge: Connected, sending auth...');
  bridge.send(JSON.stringify({
    type: 'auth',
    role: 'bridge',
    secret,
    clientId: 'test-bridge-1'
  }));
});

bridge.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('Bridge received:', message);

  if (message.type === 'auth_success') {
    console.log('Bridge: Authenticated, sending hello...');
    bridge.send(JSON.stringify({
      type: 'hello',
      capabilities: ['pageview', 'screenshot', 'console', 'error'],
      route: '/products/1',
      url: 'https://example.com/products/1'
    }));
  }

  if (message.type === 'hello_ack') {
    console.log('Bridge: Hello acknowledged, will send test events in 1s...\n');

    setTimeout(() => {
      // Send events with different levels
      const events = [
        { type: 'error', level: 'error', message: 'Test error', timestamp: Date.now() },
        { type: 'console', level: 'warn', message: 'Test warning', timestamp: Date.now() },
        { type: 'console', level: 'info', message: 'Test info', timestamp: Date.now() },
        { type: 'console', level: 'debug', message: 'Test debug', timestamp: Date.now() },
        { type: 'pageview', level: 'info', message: 'Page viewed', url: '/products/1', timestamp: Date.now() }
      ];

      events.forEach((event, i) => {
        setTimeout(() => {
          console.log(`Bridge: Sending ${event.type} (${event.level}): ${event.message}`);
          bridge.send(JSON.stringify(event));
        }, i * 500);
      });
    }, 1000);
  }
});

// Create consumer client 1 (errors only, default)
setTimeout(() => {
  const consumer1 = new WebSocket(url);

  consumer1.on('open', () => {
    console.log('\nConsumer1: Connected, sending auth...');
    consumer1.send(JSON.stringify({
      type: 'auth',
      role: 'consumer',
      secret,
      clientId: 'test-consumer-errors-only'
    }));
  });

  consumer1.on('message', (data) => {
    const message = JSON.parse(data.toString());

    if (message.type === 'auth_success') {
      console.log('Consumer1: Authenticated (no subscribe = errors only by default)');
      return;
    }

    if (message.type !== 'subscribe_ack') {
      console.log('Consumer1 received:', message.type, message.level, '-', message.message);
    }
  });
}, 500);

// Create consumer client 2 (warn + info levels)
setTimeout(() => {
  const consumer2 = new WebSocket(url);

  consumer2.on('open', () => {
    console.log('\nConsumer2: Connected, sending auth...');
    consumer2.send(JSON.stringify({
      type: 'auth',
      role: 'consumer',
      secret,
      clientId: 'test-consumer-warn-info'
    }));
  });

  consumer2.on('message', (data) => {
    const message = JSON.parse(data.toString());

    if (message.type === 'auth_success') {
      console.log('Consumer2: Authenticated, subscribing to warn+info...');
      consumer2.send(JSON.stringify({
        type: 'subscribe',
        levels: ['warn', 'info']
      }));
      return;
    }

    if (message.type === 'subscribe_ack') {
      console.log('Consumer2: Subscription acknowledged:', message.levels);
      return;
    }

    console.log('Consumer2 received:', message.type, message.level, '-', message.message);
  });
}, 700);

// Create consumer client 3 (trace level + pageview capability)
setTimeout(() => {
  const consumer3 = new WebSocket(url);

  consumer3.on('open', () => {
    console.log('\nConsumer3: Connected, sending auth...');
    consumer3.send(JSON.stringify({
      type: 'auth',
      role: 'consumer',
      secret,
      clientId: 'test-consumer-trace-pageview'
    }));
  });

  consumer3.on('message', (data) => {
    const message = JSON.parse(data.toString());

    if (message.type === 'auth_success') {
      console.log('Consumer3: Authenticated, subscribing to trace+pageview...');
      consumer3.send(JSON.stringify({
        type: 'subscribe',
        levels: ['trace'],
        capabilities: ['pageview']
      }));
      return;
    }

    if (message.type === 'subscribe_ack') {
      console.log('Consumer3: Subscription acknowledged:', message.levels, message.capabilities);
      return;
    }

    console.log('Consumer3 received:', message.type, message.level, '-', message.message);
  });
}, 900);

// Clean exit after test
setTimeout(() => {
  console.log('\n\nTest completed. Expected results:');
  console.log('- Consumer1 (errors only): Should only receive error event');
  console.log('- Consumer2 (warn+info): Should receive error, warn, and info events (but not debug)');
  console.log('- Consumer3 (trace+pageview): Should receive all events');
  console.log('\nExiting...');
  process.exit(0);
}, 6000);
