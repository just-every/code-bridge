# Usage & Configuration

This document keeps the details that were trimmed from `README.md`.

## Configuration options (JS/TS)
```ts
interface BridgeOptions {
  url?: string;            // default ws://localhost:9876
  port?: number;           // used if url not provided
  secret?: string;
  projectId?: string;
  enabled?: boolean;       // force on/off; otherwise auto-dev
  enableNavigation?: boolean; // default true (web/RN)
  enablePageview?: boolean;   // default false (opt-in)
  enableNetwork?: boolean;    // default true (web/Node)
  enableScreenshot?: boolean; // default false (opt-in, dev-only)
  enableControl?: boolean;    // default false (dev-only)
  throttleMs?: number; maxBreadcrumbs?: number;
  screenshotProvider?: () => Promise<{ mime: string; data: string }>;
}
```

### Auto-enable rules
1. `CODE_BRIDGE=1` → force enable
2. `enabled: false` → force disable
3. `enabled: true` → force enable
4. Dev mode + (`url` or `secret` present) → enable (default)
5. Otherwise disabled (production default, tree-shakeable)

Dev mode checks: `NODE_ENV === 'development'`, `import.meta.env.DEV`, or `__DEV__` (React Native).

## Capabilities
- Default: `error`, `console`, `navigation`, `network`
- Optional: `pageview` (enablePageview), `screenshot` (enableScreenshot), `control` (enableControl)
- Bridges advertise capabilities in the `hello` frame; consumers subscribe per capability.

## Pageview tracking
Opt-in via `enablePageview: true`, then `bridge.trackPageview({ route?, url? })`. Web defaults route/url when omitted.

## Screenshots
Opt-in via `enableScreenshot: true` and provide `screenshotProvider` that returns `{ mime, data }` (base64). The SDK does not capture images itself; it just transports what you provide.

## Host details
- CLI: `npx code-bridge-host [workspace] [--port=9876]`
- Writes `.code/code-bridge.json` with `url`, `port`, `secret`, `workspacePath`, `startedAt`
- Auth: first frame `auth { secret, role: 'bridge'|'consumer' }`
- Bridges send `hello { capabilities, platform, projectId, route, url }`
- Consumers can filter via `subscribe { levels, capabilities, llm_filter }`

## Protocol notes
- Heartbeat default: ping every 15s, timeout 30s (JS/TS reference)
- Network capture flags 4xx/5xx as `error` level (JS/TS, Node/web)
- Control channel: bridge replies with `control_result` matching incoming `control_request` `id`

## Where to go next
- Per-language quickstarts: `docs/clients/README.md`
- Status matrix and roadmap: `docs/clients/status.md`
- Roblox / Lua specifics: `docs/clients/roblox.md`
