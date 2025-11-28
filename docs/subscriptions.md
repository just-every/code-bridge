# Subscriptions & Capabilities

`code-bridge-host` supports per-consumer subscriptions and bridge capability adverts so consumers only receive the events they care about.

## Message Shapes

- **Bridge → Host: hello**
  ```json
  {
    "type": "hello",
    "capabilities": ["error", "console", "pageview", "screenshot", "control"],
    "platform": "web" | "node" | "react-native" | "unknown",
    "projectId": "my-app",
    "route": "/dashboard",
    "url": "https://example.com/dashboard"
  }
  ```
  Host stores these capabilities per bridge and replies with `hello_ack`.

- **Consumer → Host: subscribe**
  ```json
  {
    "type": "subscribe",
    "levels": ["errors", "warn", "info", "trace"],
    "capabilities": ["pageview", "screenshot"],
    "llm_filter": "off" | "minimal" | "aggressive"
  }
  ```
  Host stores subscription state per consumer and replies with `subscribe_ack`.

## Level Hierarchy

Subscription levels are hierarchical: `errors` < `warn` < `info` < `trace`.

Log level → subscription level mapping:

- `error` → `errors`
- `warn` → `warn`
- `info` / `log` → `info`
- `debug` → `trace`

Consumers receive events whose mapped subscription level is **≤** their highest requested level.

## Capability Filtering

- Consumers may request specific capabilities (e.g., `['pageview']`).
- Capability-gated events (`pageview`, `screenshot`, `control`) are routed only when **both**:
  - The consumer subscribed to that capability, and
  - The bridge advertised it in its `hello` frame.
- Bridges without a `hello` frame skip capability enforcement (backward compatible behavior).

## Defaults & Guardrails

- No `subscribe` message → defaults to `levels: ['errors']`, no capability filter, `llm_filter: 'off'`.
- `llm_filter` (optional) drops noisy events before delivery:
  - `off` – deliver everything that passes subscription checks.
  - `minimal` – drop `debug` and `log` levels.
  - `aggressive` – drop `debug`, `log`, and `info` levels.
  - Overload guard: if >500 events arrive in 10s and filter is not `off`, host allows only `error` level for that window.
- Connection close cleans up subscription and capability state.

## Demo

1. Start a host: `npx code-bridge-host` (writes `.code/code-bridge.json`).
2. Run the flow demo: `node demo/test-subscription-flow.js`.
3. Expected delivery:
   - Consumer1 (no subscribe) → error events only.
   - Consumer2 (`warn` + `info`) → error, warn, info.
   - Consumer3 (`trace` + `pageview`) → all events including pageview.

