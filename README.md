# @just-every/code-bridge

Development-only bridge for capturing errors and logs from web, Node.js, and React Native applications and sending them to a centralized debugging server.

What’s included:
- Client SDK (`startBridge`) for web/Node/RN (auto-ensures a host in dev)
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

  // Enable pageview tracking (default: false, dev-only)
  enablePageview?: boolean;

  // Enable screenshot sending (default: false, dev-only)
  enableScreenshot?: boolean;
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

## Capabilities

The bridge client advertises its capabilities to the host upon connection via a `hello` frame:

```typescript
interface HelloMessage {
  type: 'hello';
  capabilities: ('error' | 'console' | 'pageview' | 'screenshot' | 'control')[];
  platform: 'web' | 'node' | 'react-native' | 'unknown';
  projectId?: string;
  route?: string;    // Current route (web/RN)
  url?: string;      // Current URL (web/RN)
}
```

**Default capabilities:**
- `error` - Captures uncaught errors and unhandled rejections
- `console` - Intercepts console.log/info/warn/error/debug calls

**Optional capabilities:**
- `pageview` - Tracks page/route changes (opt-in via `enablePageview: true`)
- `screenshot` - Sends pre-encoded screenshots (opt-in via `enableScreenshot: true`)
- `control` - Allows consumers (e.g., Code) to send control commands; opt-in via `enableControl: true` and handle them with `onControl(...)`

## Subscriptions & Filtering

`code-bridge-host` keeps per-consumer subscriptions so each consumer only receives the events it wants.

- Bridges advertise capabilities in a `hello` frame (`capabilities: ['error', 'console', 'pageview', 'screenshot', 'control']`).
- Consumers can send a `subscribe` frame with `levels: ['errors'|'warn'|'info'|'trace']`, optional `capabilities`, and optional `llm_filter` (`off|minimal|aggressive`).
- No `subscribe` → default to errors only; capability-gated events (pageview, screenshot, control) require the consumer to request them and the bridge to have advertised them.
- See `docs/subscriptions.md` for the exact shapes and filtering logic; run `node demo/test-subscription-flow.js` (with a host running) to observe routing.

### 30-second setup (npm user)
1. In your app (dev build):
   ```ts
   import { startBridge } from '@just-every/code-bridge';
   const bridge = startBridge({ enableScreenshot: false, enableControl: false });
   ```
   - Defaults to errors-only; no screenshots/control unless enabled.
   - In dev, `startBridge` will auto-ensure the host (using the local bin or `npx code-bridge-host` if none is running) and connect.
2. Start Code in the same workspace (`code` or `code exec ...`); it auto-connects as a consumer and shows developer messages from the bridge.


## Pageview Tracking

Pageview tracking is **opt-in** and **dev-only**. Enable it to track route changes in your application:

```typescript
const bridge = startBridge({
  projectId: 'my-app',
  enablePageview: true,  // Opt-in to pageview tracking
});

// Manual pageview tracking
bridge.trackPageview({ route: '/dashboard', url: 'https://example.com/dashboard' });

// Or use auto-detected values (web only)
bridge.trackPageview({});  // Uses window.location.href and window.location.pathname
```

**Note:** Pageview events are only sent when `enablePageview: true` is set in options. Calling `trackPageview()` without enabling it will log a warning.

## Screenshot Sending

Screenshot sending is **opt-in** and **dev-only**. Enable it to send pre-encoded screenshots from your application:

```typescript
const bridge = startBridge({
  projectId: 'my-app',
  enableScreenshot: true,  // Opt-in to screenshot sending
});

// Send a screenshot (you must provide pre-encoded image data)
// Example 1: Using base64-encoded data
const canvas = document.querySelector('canvas');
const dataUrl = canvas.toDataURL('image/png');
const base64Data = dataUrl.split(',')[1]; // Strip "data:image/png;base64," prefix

bridge.sendScreenshot({
  mime: 'image/png',
  data: base64Data,
  url: window.location.href,    // Optional
  route: window.location.pathname, // Optional
});

// Example 2: Send a screenshot from an existing image
fetch('/screenshot.png')
  .then(res => res.blob())
  .then(blob => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      bridge.sendScreenshot({
        mime: 'image/png',
        data: base64,
      });
    };
    reader.readAsDataURL(blob);
  });
```

**Important notes:**
- Screenshot sending is **dev-only** and disabled by default
- The SDK does **NOT** automatically capture screenshots - you must provide pre-encoded image data
- Pass `mime` and `data` (base64-encoded) to `sendScreenshot()`
- Optional `url` and `route` parameters are auto-detected in web environments
- This API is a **transport layer only** - it sends whatever image data you provide to the bridge host

**Note:** Screenshot events are only sent when `enableScreenshot: true` is set in options. Calling `sendScreenshot()` without enabling it will log a warning.

## Event Schema

Events sent to the server follow this structure:

```typescript
interface BridgeEvent {
  type: 'error' | 'log' | 'console' | 'pageview' | 'screenshot';
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
  url?: string;      // For pageview and screenshot events
  route?: string;    // For pageview and screenshot events
  mime?: string;     // For screenshot events
  data?: string;     // For screenshot events (base64-encoded image)
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

### Subscription filtering demo

With `code-bridge-host` running (so `.code/code-bridge.json` exists), run:

```bash
node demo/test-subscription-flow.js
```

This spins up one bridge and three consumers to show level and capability filtering in action.

### Dev demo with Code host

If you have `code` running in a workspace, it writes `.code/code-bridge.json` with the WebSocket port and secret. After building this package (`npm run build`), run:

```bash
node demo/workspace-bridge-demo.js /path/to/that/workspace
```

The script reads the metadata, connects with `startBridge`, sends a few console logs, triggers an unhandled rejection, and throws an uncaught error. You should see these appear as developer messages in the active Code session.

To wire your app during development, read the same metadata and call `startBridge({ url, secret, projectId })` early in your app startup. The bridge will auto-enable in dev mode when `url` or `secret` is provided.

**Advanced override:** Set `CODE_BRIDGE=1` to force-enable the bridge even without dev mode detection (useful for testing production builds locally).

### Screenshots (opt-in, dev-only)
- Enable in your app: `startBridge({ enableScreenshot: true, ... })`
- Send a pre-encoded image: `conn.sendScreenshot({ mime: 'image/png', data: '<base64>' })`
- Host forwards only if the bridge advertised `screenshot` and the consumer subscribed to `screenshot`; rate-limited per bridge.

### Using with Code (consumer)

- Start the host in your workspace: `npx code-bridge-host /path/to/workspace` (writes `.code/code-bridge.json`).
- Start `code` (TUI or `code exec ...`) in the same workspace; it auto-detects the metadata, connects as a consumer, and posts a developer message with the host details.
- Run any app/demo that calls `startBridge`—in dev it will auto-ensure the host (spawns it if missing), then connect. Events stream into all active Code sessions on that workspace.

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

2. **Hello frame** (from bridge clients after auth):
   ```json
   {
     "type": "hello",
     "capabilities": ["error", "console", "pageview"],
     "platform": "web",
     "projectId": "my-app",
     "route": "/dashboard",
     "url": "https://example.com/dashboard"
   }
   ```

3. **Bridge events** (from bridge → consumers):
   - Bridge clients send `BridgeEvent` objects
   - Host broadcasts to all authenticated consumer clients

4. **Response** (after auth):
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
