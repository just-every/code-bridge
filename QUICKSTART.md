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

You should see events being logged in the server terminal. The demo uses `enabled: true` to force the bridge on (regular dev apps auto-enable when a host is present or will spawn it if missing).

**Full-fidelity Node capture (network + control):**

```bash
node -e "const { startBridge } = require('./dist'); const bridge = startBridge({ enabled: true, enableControl: true }); fetch('https://httpbin.org/status/404'); setTimeout(() => bridge.disconnect(), 2000);"
```

This exercises console/error hooks plus the Node http/https/fetch wrappers (network is on by default) and flags 4xx/5xx as errors.

### 3. Test with Web

After building (`npm run build`), open `demo/web-demo.html` in a browser. Make sure the server is running first.

Click the buttons to send different types of events. Check the browser console and server terminal for output.

For SPA navigation + network capture, serve any dev app (or `demo/web-demo.html`) and include:

```html
<script type="module">
  import { startBridge } from '../dist/index.mjs';
  startBridge({ enabled: true, enableControl: true });
</script>
```

Then trigger client-side route changes and fetch/XHR calls; 4xx/5xx responses will be emitted as `error`-level network events.

### 4. Test end-to-end with a running `code` workspace

If you have `code` running, the host will be auto-ensured by `startBridge()` if none is running. After building:

```bash
node demo/workspace-bridge-demo.js /path/to/workspace
```

This will auto-connect, emit sample logs, an unhandled rejection, and an uncaught error so they appear as developer messages in your Code session. The demo uses `enabled: true` to force the bridge on.

Tip: In normal dev apps, just call `startBridge()`; it will ensure a host is running (dev-only) and connect automatically. To send screenshots, enable `enableScreenshot: true` and call `sendScreenshot({ mime, data })`. To receive control commands in your app, enable `enableControl: true` and register `onControl((msg) => console.log(msg))`.

Tip: Navigation and network capture are opt-out; disable with `enableNavigation: false` or `enableNetwork: false` if you don't want them.

Tip: If you prefer non-interactive, you can run `code exec "echo hi"` in the same workspace; Code will subscribe as a consumer while the command runs and will receive bridge events.

### 5. Optional: Test subscription filtering

With `code-bridge-host` running (so `.code/code-bridge.json` exists), run:

```bash
node demo/test-subscription-flow.js
```

This spawns one bridge and three consumers to demonstrate level and capability filtering.

### 6. MCP (Claude Code / Gemini CLI) quickstart

1. Ensure the host is running in your workspace (creates `.code/code-bridge.json`):
   ```bash
   npx code-bridge-host
   ```
2. Start the MCP server over stdio (connects as a consumer):
   ```bash
   npx code-bridge-mcp
   ```
3. Point your MCP-capable CLI to the command above. For Claude Desktop, add to `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "code-bridge": {
         "command": "npx",
         "args": ["code-bridge-mcp"],
         "cwd": "/path/to/workspace"
       }
     }
   }
   ```
The MCP server streams live bridge events as notifications (`bridge/event`), exposes recent data as resources (`bridge://events/*`), and forwards `send_control` tool calls to connected bridges.

## Integration Guide

### Web App (Vite/React/Vue)

```javascript
// src/main.js or src/index.js
import { startBridge } from '@just-every/code-bridge';

// Initialize once at app startup
const bridge = startBridge({
  projectId: 'my-web-app',
  enablePageview: true,  // Optional: enable pageview tracking
});

// Manual pageview tracking (when enabled)
bridge.trackPageview({ route: '/home' });

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
import { useNavigation } from '@react-navigation/native';  // Example with React Navigation

export default function App() {
  const navigation = useNavigation();

  useEffect(() => {
    const bridge = startBridge({
      projectId: 'my-mobile-app',
      enablePageview: true,  // Optional: enable pageview tracking
    });

    // Optional: Track navigation changes (React Navigation example)
    const unsubscribe = navigation.addListener('state', () => {
      const currentRoute = navigation.getCurrentRoute();
      bridge.trackPageview({ route: currentRoute?.name });
    });

    return () => {
      unsubscribe();
      bridge.disconnect();
    };
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
- **Pageviews**: Route/URL changes (opt-in with `enablePageview: true`)
- **Stack Traces**: Automatically captured for errors
- **Breadcrumbs**: History of console events leading up to errors (last 50 by default)

## Pageview Tracking

Pageview tracking is **opt-in** and helps you understand user navigation patterns:

```javascript
// Enable pageview tracking
const bridge = startBridge({
  projectId: 'my-app',
  enablePageview: true,
});

// Track pageviews manually
bridge.trackPageview({ route: '/dashboard', url: 'https://example.com/dashboard' });

// Auto-detect current location (web only)
bridge.trackPageview({});
```

**When to use pageview tracking:**
- Single Page Applications (SPAs) with client-side routing
- React Navigation in React Native
- Any app where you want to track navigation flow

**Note:** Pageview tracking is dev-only and disabled by default. Set `enablePageview: true` to enable it.

## Screenshot Sending

Screenshot sending is **opt-in** and helps you send pre-encoded screenshots to the debugging server:

```javascript
// Enable screenshot sending
const bridge = startBridge({
  projectId: 'my-app',
  enableScreenshot: true,
});

// Send a screenshot (web example using canvas)
const canvas = document.querySelector('canvas');
const dataUrl = canvas.toDataURL('image/png');
const base64Data = dataUrl.split(',')[1]; // Strip data URL prefix

bridge.sendScreenshot({
  mime: 'image/png',
  data: base64Data,
  url: window.location.href,     // Optional
  route: window.location.pathname, // Optional
});
```

**When to use screenshot sending:**
- Debugging canvas-based applications or games
- Sending visual snapshots of UI states
- Capturing rendered output for analysis

**Note:** Screenshot sending is dev-only and disabled by default. Set `enableScreenshot: true` to enable it. The SDK does NOT automatically capture screenshots - you must provide the pre-encoded image data.

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
