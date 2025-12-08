// Simple WebSocket server for testing the bridge
// Run with: node demo/server.js

const WebSocket = require('ws');

const PORT = 9876;
const SECRET = 'dev-secret';

const wss = new WebSocket.Server({ port: PORT });

console.log(`WebSocket server listening on ws://localhost:${PORT}`);
console.log('Waiting for connections...\n');

wss.on('connection', (ws, req) => {
  const secret = req.headers['x-bridge-secret'];
  const clientId = Math.random().toString(36).substring(7);

  console.log(`[${clientId}] New connection from ${req.socket.remoteAddress}`);

  if (secret && secret !== SECRET) {
    console.log(`[${clientId}] Invalid secret, closing connection`);
    ws.close(1008, 'Invalid secret');
    return;
  }

  let authenticated = !!secret;

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());

      // Handle auth message for web/RN clients
      if (event.type === 'auth') {
        if (event.secret === SECRET) {
          authenticated = true;
          console.log(`[${clientId}] Authenticated`);
        } else {
          console.log(`[${clientId}] Invalid secret in auth message`);
          ws.close(1008, 'Invalid secret');
        }
        return;
      }

      if (!authenticated) {
        console.log(`[${clientId}] Unauthenticated event, ignoring`);
        return;
      }

      if (event.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      // Log received event
      console.log(`[${clientId}] Event received:`);
      console.log(`  Type: ${event.type}`);
      console.log(`  Level: ${event.level}`);
      console.log(`  Platform: ${event.platform}`);
      console.log(`  Project: ${event.projectId || 'N/A'}`);
      console.log(`  Message: ${event.message}`);
      if (event.stack) {
        console.log(`  Stack: ${event.stack.split('\n')[0]}...`);
      }
      if (event.breadcrumbs && event.breadcrumbs.length > 0) {
        console.log(`  Breadcrumbs: ${event.breadcrumbs.length} items`);
      }
      console.log('');
    } catch (err) {
      console.error(`[${clientId}] Error parsing message:`, err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[${clientId}] Connection closed\n`);
  });

  ws.on('error', (err) => {
    console.error(`[${clientId}] WebSocket error:`, err.message);
  });
});

wss.on('error', (err) => {
  console.error('Server error:', err);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
