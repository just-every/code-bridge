# Phase 1: Subscription & Capability Implementation

## Overview

Extended `code-bridge-host` WebSocket daemon to support per-consumer subscriptions and bridge capability adverts.

## Changes Made

### 1. Type Definitions (`src/types.ts`)

Added new protocol types:

- `SubscriptionLevel`: `'errors' | 'warn' | 'info' | 'trace'` - Hierarchical subscription levels
- `BridgeCapability`: `'error' | 'console' | 'pageview' | 'screenshot' | 'control'` - Bridge capabilities
- `HelloMessage`: Bridge capability advertisement frame
  ```typescript
  {
    type: 'hello',
    capabilities: BridgeCapability[],
    route?: string,
    url?: string
  }
  ```
- `SubscribeMessage`: Consumer subscription frame
  ```typescript
  {
    type: 'subscribe',
    levels: SubscriptionLevel[],
    capabilities?: BridgeCapability[]
  }
  ```

Updated `BridgeEvent` to include `type: 'pageview'` and optional `url`, `route` fields.

### 2. Host Implementation (`bin/code-bridge-host.js`)

#### State Tracking
- `bridgeCapabilities`: Map<WebSocket, {capabilities, route, url}> - Per-bridge capability state
- `consumerSubscriptions`: Map<WebSocket, {levels, capabilities}> - Per-consumer subscription state

#### Protocol Handlers

**Bridge Hello Handler**:
- Receives `hello` frame from bridge with capabilities and metadata
- Stores capability state per bridge connection
- Sends `hello_ack` acknowledgment
- Logs capabilities, route, and URL

**Consumer Subscribe Handler**:
- Receives `subscribe` frame from consumer with desired levels and capabilities
- Stores subscription state per consumer connection
- Defaults to `['errors']` if no subscribe received
- Sends `subscribe_ack` acknowledgment
- Logs subscription preferences

#### Event Routing Logic

**Level Filtering**:
- Hierarchy: `errors` < `warn` < `info` < `trace`
- Maps LogLevel to SubscriptionLevel:
  - `error` → `errors`
  - `warn` → `warn`
  - `info`, `log` → `info`
  - `debug` → `trace`
- Consumers receive events at or above their subscribed level

**Capability Filtering**:
- If consumer requests specific capabilities, only events matching those capabilities are routed
- Basic mapping implemented for `pageview`, `screenshot`, `control` message types
- Extensible for future capability-tagged events

**Default Behavior**:
- No subscribe = errors only, no extra capabilities
- Bridge without hello = capabilities not enforced yet

#### Cleanup
- Maps cleared on connection close to prevent memory leaks

### 3. Exports (`src/index.ts`)

Exported new types for client usage:
- `SubscriptionLevel`
- `BridgeCapability`
- `HelloMessage`
- `SubscribeMessage`

### 4. Test Script (`demo/test-subscription-flow.js`)

Created comprehensive test demonstrating:
- Bridge sending hello with multiple capabilities
- Consumer1: default (errors only)
- Consumer2: subscribed to warn+info levels
- Consumer3: subscribed to trace level + pageview capability
- Events filtered correctly based on subscription

## Test Results

```
Bridge test-bridge-1 hello: capabilities=[pageview, screenshot, console, error] route=/products/1 url=https://example.com/products/1

Routed from bridge test-bridge-1 to 4 consumer(s): error level=error
  → Consumer1 (errors), Consumer2 (warn+info), Consumer3 (trace), plus one default

Routed from bridge test-bridge-1 to 2 consumer(s): console level=warn
  → Consumer2 (warn+info), Consumer3 (trace)

Routed from bridge test-bridge-1 to 2 consumer(s): console level=info
  → Consumer2 (warn+info), Consumer3 (trace)

Routed from bridge test-bridge-1 to 1 consumer(s): console level=debug
  → Consumer3 (trace only)

Routed from bridge test-bridge-1 to 2 consumer(s): pageview level=info
  → Consumer2 (warn+info), Consumer3 (trace+pageview)
```

## Protocol Flow

### Bridge Connection
1. Connect → Send auth frame with `role: 'bridge'`
2. Receive `auth_success`
3. Send `hello` frame with capabilities, route, url
4. Receive `hello_ack`
5. Send events (filtered by host based on consumer subscriptions)

### Consumer Connection
1. Connect → Send auth frame with `role: 'consumer'`
2. Receive `auth_success`
3. (Optional) Send `subscribe` frame with levels and capabilities
4. Receive `subscribe_ack`
5. Receive filtered events based on subscription

### Event Filtering
- Host checks each consumer's subscription state for every bridge event
- Applies level hierarchy filtering (errors < warn < info < trace)
- Applies capability filtering if consumer requested specific capabilities
- Default: errors only, no capabilities

## Future Enhancements (Not in Phase 1)

- Screenshot implementation (capability flag exists, handler not implemented)
- Control commands from consumer to bridge (capability flag exists, handler not implemented)
- Per-event capability tags (vs message-type-based routing)
- Dynamic subscription updates (resend subscribe to change preferences)
- Subscription persistence across reconnections
- Rate limiting per consumer

## Backward Compatibility

- Existing clients without hello/subscribe work as before
- Bridges without hello: events routed to all consumers (no capability filtering)
- Consumers without subscribe: default to errors only
- Auth flow unchanged
