# Quick Start Guide

## Testing the SDK Locally

### 1. Start the WebSocket Server

In one terminal:

```bash
node demo/server.js
```

This starts a WebSocket server on `ws://localhost:9876` that receives and logs all events.

### 2. Test with Node.js

In another terminal:

```bash
node demo/node-demo.js
```

You should see events being logged in the server terminal. The demo uses `enabled: true` to force the bridge on.

### 3. Test with Web

After building (`npm run build`), open `demo/web-demo.html` in a browser. Make sure the server is running first.

Click the buttons to send different types of events. Check the browser console and server terminal for output.

### 4. Test end-to-end with a running `code` workspace

If you have `code` running, it writes `.code/code-bridge.json` with the bridge host details. After building:

```bash
node demo/workspace-bridge-demo.js /path/to/workspace
```

This will auto-connect to the host, emit sample logs, an unhandled rejection, and an uncaught error so they appear as developer messages in your Code session. The demo uses `enabled: true` to force the bridge on.

Tip: If you prefer non-interactive, you can run `code exec "echo hi"` in the same workspace; Code will subscribe as a consumer while the command runs and will receive bridge events.

## Integration Guide

### Web App (Vite/React/Vue)

```javascript
// src/main.js or src/index.js
import { startBridge } from '@just-every/code-bridge';

// Initialize once at app startup
startBridge({
  projectId: 'my-web-app',
});

// Your app code here
```

### Node.js Server

```javascript
// At the top of your main file
import { startBridge } from '@just-every/code-bridge';

const bridge = startBridge({
  projectId: 'my-api-server',
});

// Your server code here
```

### React Native

```javascript
// App.tsx
import { useEffect } from 'react';
import { startBridge } from '@just-every/code-bridge';

export default function App() {
  useEffect(() => {
    const bridge = startBridge({
      projectId: 'my-mobile-app',
    });

    return () => bridge.disconnect();
  }, []);

  // Rest of your app
}
```

## Auto-Enable Behavior

The bridge automatically enables in development when you provide a `url` or `secret`:

**Gating Priority:**

1. `CODE_BRIDGE=1` environment variable → force on (overrides everything)
2. `enabled: false` in options → force off
3. `enabled: true` in options → force on
4. Dev mode detected + (`url` or `secret` provided) → auto-enable
5. Otherwise → disabled (production default)

**Dev mode detection:**
- Node.js: `NODE_ENV=development`
- Vite: `import.meta.env.DEV`
- React Native: `__DEV__`

This means typical usage in development just works without `CODE_BRIDGE=1`:

```javascript
// Auto-enables in dev mode because url is provided
startBridge({
  url: 'ws://localhost:9876',
  projectId: 'my-app',
});
```

Use `CODE_BRIDGE=1` only when you need to force-enable in non-dev environments (e.g., testing production builds locally).

## Production Safety

The bridge is completely no-op in production unless you explicitly set `enabled: true` in options. This means:

- Zero runtime overhead in production builds
- Tree-shakeable - bundlers can remove unused code
- No WebSocket connections attempted
- No console patching
- No error handler installation

## Event Types

The bridge captures:

- **Global Errors**: Uncaught exceptions, unhandled promise rejections
- **Console Calls**: log, info, warn, error, debug
- **Stack Traces**: Automatically captured for errors
- **Breadcrumbs**: History of console events leading up to errors (last 50 by default)

## Using the Host Server

### Starting `code-bridge-host`

The recommended way to run the bridge is using the included `code-bridge-host` CLI:

```bash
# Install globally
npm install -g @just-every/code-bridge

# Or run with npx (no install needed)
npx code-bridge-host
```

This starts a WebSocket server that:
- Locks to a single instance per workspace (`.code/code-bridge.lock`)
- Picks an available port (default: 9876)
- Generates a random secret
- Writes `.code/code-bridge.json` with connection details
- Supports both bridge clients (apps) and consumer clients (Code, CLIs, MCP tools)

### Consumer Client Example

Consumer clients receive all events from bridge clients. Here's how to create one:

```javascript
const fs = require('fs');
const WebSocket = require('ws');

// Read metadata written by code-bridge-host
const meta = JSON.parse(fs.readFileSync('.code/code-bridge.json', 'utf8'));

const ws = new WebSocket(meta.url);

ws.on('open', () => {
  // Authenticate as consumer
  ws.send(JSON.stringify({
    type: 'auth',
    secret: meta.secret,
    role: 'consumer',
    clientId: 'my-cli-tool',
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);

  // Handle events from bridge clients
  console.log(`[${event.level}] ${event.message}`);

  if (event.stack) {
    console.log(event.stack);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', () => {
  console.log('Disconnected from bridge host');
});
```

### Bridge Client Example

Bridge clients (apps using `startBridge`) auto-connect when they read the metadata:

```javascript
const fs = require('fs');
const { startBridge } = require('@just-every/code-bridge');

const meta = JSON.parse(fs.readFileSync('.code/code-bridge.json', 'utf8'));

// This will auto-enable in dev mode because url and secret are provided
const bridge = startBridge({
  url: meta.url,
  secret: meta.secret,
  projectId: 'my-app',
});

// Your app code - all console logs and errors will be sent to consumers
console.log('App started');
throw new Error('Test error');
```

### Protocol Summary

**Authentication (first message from client):**
```json
{
  "type": "auth",
  "secret": "<secret-from-metadata>",
  "role": "bridge" | "consumer",
  "clientId": "my-app"
}
```

**Auth response (from host):**
```json
{
  "type": "auth_success",
  "role": "bridge",
  "clientId": "my-app"
}
```

**Event flow:**
- Bridge clients → Host → All consumer clients
- Consumers receive `BridgeEvent` objects as JSON

## Server Requirements

If you want to implement a custom WebSocket server instead of using `code-bridge-host`:

1. Listen on the configured URL (default: `ws://localhost:9876`)
2. Accept the `X-Bridge-Secret` header for Node.js clients
3. Accept an `{type: 'auth', secret: '...'}` message for web/RN clients
4. Receive JSON-encoded `BridgeEvent` objects

See `demo/server.js` for a minimal reference implementation.
