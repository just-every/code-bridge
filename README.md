# @just-every/code-bridge

Development-only bridge for capturing errors and logs from web, Node.js, and React Native applications and sending them to a centralized debugging server.

What’s included:
- Client SDK (`startBridge`) for web/Node/RN
- Shared host daemon (`code-bridge-host`) that fans out events from many bridge clients to many consumers
- Workspace demo scripts for quick verification with Code

## Features

- **Zero production overhead**: Completely no-op unless dev mode is detected
- **Universal**: Works in web browsers, Node.js, and React Native
- **Auto-detection**: Automatically detects platform and dev mode
- **Global error capture**: Hooks into unhandled errors and promise rejections
- **Console patching**: Intercepts console.log/info/warn/error/debug calls
- **Breadcrumbs**: Tracks history of events for better debugging context
- **Throttling**: Built-in throttling to prevent event spam
- **Tree-shakeable**: Won't bloat your production bundles

## Installation

```bash
npm install @just-every/code-bridge
# or
yarn add @just-every/code-bridge
# or
pnpm add @just-every/code-bridge
```

## Quick Start

### Web Application

```typescript
import { startBridge } from '@just-every/code-bridge';

// Initialize at app startup
const bridge = startBridge({
  url: 'ws://localhost:9876',
  secret: 'dev-secret',
  projectId: 'my-web-app',
});

// The bridge will now capture all errors and console logs
// Clean up when needed (e.g., on unmount)
// bridge.disconnect();
```

### Node.js

```typescript
import { startBridge } from '@just-every/code-bridge';

const bridge = startBridge({
  url: 'ws://localhost:9876',
  secret: 'dev-secret',
  projectId: 'my-node-app',
});

// Your app code here
```

### React Native

```typescript
import { useEffect } from 'react';
import { startBridge } from '@just-every/code-bridge';

function App() {
  useEffect(() => {
    const bridge = startBridge({
      url: 'ws://localhost:9876',
      secret: 'dev-secret',
      projectId: 'my-rn-app',
    });

    return () => bridge.disconnect();
  }, []);

  // Rest of your app
}
```

## Configuration Options

```typescript
interface BridgeOptions {
  // WebSocket URL (default: ws://localhost:9876)
  url?: string;

  // Port number (used if url is not provided)
  port?: number;

  // Shared secret for authentication
  secret?: string;

  // Project identifier
  projectId?: string;

  // Maximum breadcrumbs to keep (default: 50)
  maxBreadcrumbs?: number;

  // Throttle delay in ms (default: 100)
  throttleMs?: number;

  // Force enable/disable (overrides auto-detection)
  enabled?: boolean;
}
```

## Auto-Enable Behavior

The bridge automatically enables itself in development when you provide a `url` or `secret`:

```typescript
// In dev mode (NODE_ENV=development, Vite DEV, or React Native __DEV__)
// this auto-enables because url is provided:
startBridge({
  url: 'ws://localhost:9876',
  projectId: 'my-app',
});
```

**Gating Priority:**

1. `CODE_BRIDGE=1` environment variable → force on (overrides everything)
2. `enabled: false` in options → force off
3. `enabled: true` in options → force on
4. Dev mode detected + (`url` or `secret` provided) → auto-enable
5. Otherwise → disabled (production default, tree-shakeable)

**Dev mode detection:**
- Node.js: `process.env.NODE_ENV === 'development'`
- Vite: `import.meta.env.DEV`
- React Native: `__DEV__`

This means you can safely call `startBridge({ url, secret })` in your code and it will:
- Auto-enable in development when config is present
- Stay disabled in production builds (zero overhead)
- Be tree-shaken out by bundlers when disabled

## Event Schema

Events sent to the server follow this structure:

```typescript
interface BridgeEvent {
  type: 'error' | 'log' | 'console';
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  stack?: string;
  timestamp: number;
  platform: 'web' | 'node' | 'react-native' | 'unknown';
  projectId?: string;
  breadcrumbs?: Array<{
    timestamp: number;
    level: string;
    message: string;
  }>;
}
```

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run Node.js demo (starts local server first: node demo/server.js)
npm test

# For web demo, open demo/web-demo.html in a browser after building

# Run end-to-end demo against a running `code` workspace
node demo/workspace-bridge-demo.js /path/to/workspace
```

### Dev demo with Code host

If you have `code` running in a workspace, it writes `.code/code-bridge.json` with the WebSocket port and secret. After building this package (`npm run build`), run:

```bash
node demo/workspace-bridge-demo.js /path/to/that/workspace
```

The script reads the metadata, connects with `startBridge`, sends a few console logs, triggers an unhandled rejection, and throws an uncaught error. You should see these appear as developer messages in the active Code session.

To wire your app during development, read the same metadata and call `startBridge({ url, secret, projectId })` early in your app startup. The bridge will auto-enable in dev mode when `url` or `secret` is provided.

**Advanced override:** Set `CODE_BRIDGE=1` to force-enable the bridge even without dev mode detection (useful for testing production builds locally).

### Using with Code (consumer)

- Start the host in your workspace: `npx code-bridge-host /path/to/workspace` (writes `.code/code-bridge.json`).
- Start `code` (TUI or `code exec ...`) in the same workspace; it auto-detects the metadata, connects as a consumer, and posts a developer message with the host details.
- Run any app/demo that calls `startBridge` with the metadata URL/secret—events stream into all active Code sessions on that workspace.

## Host Server

### Using `code-bridge-host` CLI

The package includes a `code-bridge-host` CLI that creates a singleton WebSocket server per workspace. This allows multiple bridge clients (apps using `startBridge`) and consumer clients (Code, other CLIs, MCP tools) to share the same stream.

**Installation:**

```bash
npm install -g @just-every/code-bridge
# or run directly with npx
npx code-bridge-host [workspace-path] [--port=9876]
```

**Usage:**

```bash
# Start host in current directory
code-bridge-host

# Start host for specific workspace
code-bridge-host /path/to/workspace

# Use custom port preference
code-bridge-host --port=8080
```

**What it does:**

1. Acquires a lock at `.code/code-bridge.lock` (single instance per workspace)
2. Finds an available port (starting from `--port` or default 9876)
3. Generates a random shared secret
4. Writes `.code/code-bridge.json` with connection details:
   ```json
   {
     "url": "ws://127.0.0.1:9876",
     "port": 9876,
     "secret": "abc123...",
     "workspacePath": "/path/to/workspace",
     "startedAt": "2024-01-01T12:00:00.000Z"
   }
   ```
5. Starts WebSocket server with role-based authentication

**Connecting as a bridge client:**

Bridge clients (apps using `startBridge`) read the metadata and connect automatically:

```javascript
const fs = require('fs');
const { startBridge } = require('@just-every/code-bridge');

const meta = JSON.parse(fs.readFileSync('.code/code-bridge.json', 'utf8'));

startBridge({
  url: meta.url,
  secret: meta.secret,
  projectId: 'my-app',
});
```

**Connecting as a consumer client:**

Consumer clients (Code, CLIs, etc.) receive events from all bridge clients:

```javascript
const fs = require('fs');
const WebSocket = require('ws');

const meta = JSON.parse(fs.readFileSync('.code/code-bridge.json', 'utf8'));

const ws = new WebSocket(meta.url);

ws.on('open', () => {
  // Authenticate as consumer
  ws.send(JSON.stringify({
    type: 'auth',
    secret: meta.secret,
    role: 'consumer',
    clientId: 'my-consumer',
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log('Event from bridge:', event);
});
```

**Protocol:**

1. **Authentication frame** (first message):
   ```json
   {
     "type": "auth",
     "secret": "<secret-from-metadata>",
     "role": "bridge" | "consumer",
     "clientId": "optional-identifier"
   }
   ```

2. **Bridge events** (from bridge → consumers):
   - Bridge clients send `BridgeEvent` objects
   - Host broadcasts to all authenticated consumer clients

3. **Response** (after auth):
   ```json
   {
     "type": "auth_success",
     "role": "bridge" | "consumer",
     "clientId": "assigned-or-provided-id"
   }
   ```

**Singleton behavior:**

- Only one host can run per workspace (enforced by lock file)
- If host process dies, stale lock is detected and cleared
- Graceful shutdown removes lock and metadata on SIGINT/SIGTERM

### Custom Server Setup

You can also implement your own WebSocket server. It should:

1. Accept WebSocket connections
2. Authenticate using the `X-Bridge-Secret` header (Node.js) or auth message (web/RN)
3. Receive and process JSON events matching the `BridgeEvent` schema

Example minimal server:

```javascript
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 9876 });

wss.on('connection', (ws, req) => {
  const secret = req.headers['x-bridge-secret'];

  ws.on('message', (data) => {
    const event = JSON.parse(data);
    console.log('Received event:', event);
  });
});
```

## Tree-Shaking

The library is designed to be tree-shakeable. In production builds (when dev mode is not detected), the entire bridge becomes a no-op and can be removed by bundlers like Webpack, Rollup, or Vite.

## License

MIT
