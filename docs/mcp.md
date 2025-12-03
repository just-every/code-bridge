# MCP Mode for code-bridge

This document explains how the MCP wrapper works, what it exposes, and how to try it with MCP-capable CLIs like Claude Code or Gemini CLI.

## Architecture

- **Existing host unchanged**: `code-bridge-host` remains the single WS fan-out. Bridges connect with `role=bridge`; consumers (including MCP wrapper) connect with `role=consumer`.
- **MCP wrapper process**: `code-bridge-mcp` starts an MCP server over stdio using `@modelcontextprotocol/sdk`. It reads `.code/code-bridge.json` to discover `url` and `secret`, connects to the host as a consumer, subscribes to events, and mirrors them into MCP.
- **Event flow**: `bridge -> host -> MCP consumer -> MCP notifications` (method `bridge/event`). Recent events are buffered for MCP resources.
- **Control flow**: MCP tool `send_control` → host `control_request` → bridge → `control_result` → MCP notification `bridge/control_result` and tool result.
- **Resources** (readable over `resources/read`):
  - `bridge://metadata` — host metadata (secret redacted)
  - `bridge://events/recent` — recent buffered events
  - `bridge://events/errors` — recent error-level events
  - `bridge://events/network` — recent network events
  - `bridge://events/navigation` — navigation/pageview events
  - `bridge://events/screenshot` — latest screenshot (if any)
  - `bridge://stats` — counts by type + last id
- **Notifications**:
  - `bridge/event` — every subscribed bridge event
  - `notifications/resources/updated` — fired when buffers change
  - `bridge/control_result` — control round-trip responses
- **Tools**:
  - `subscribe_to_events(levels?, capabilities?, llm_filter?)`
  - `send_control(action, args?, code?, timeoutMs?, expectResult?)`

## Manual CLI smoke (Claude Desktop example)

1) Start host in workspace: `npx code-bridge-host`
2) Start MCP server: `npx code-bridge-mcp`
3) Add to `claude_desktop_config.json`:
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
4) In Claude Code chat: ask “List available MCP tools” or “Show recent errors from bridge://events/errors”.

Gemini CLI is similar: configure an MCP server entry pointing to `code-bridge-mcp` in the workspace.

### Current smoke status
- Automated in-repo integration test exercises MCP over an in-memory stdio loopback (host + mock bridge) and verifies tools/resources/control.
- Claude CLI binary is present (`claude --help`), but a real MCP smoke was **not run** because it requires an authenticated Claude session, which is not configured in this environment. Run the steps above on a machine where Claude Code or Gemini CLI is signed in to validate end-to-end.

## Notes
- The MCP layer is additive; existing Code integration keeps streaming/controls unchanged.
- The wrapper uses stdio transport by default; tests use an in-memory stdio pair for speed.
- Subscription defaults mirror host (errors/warn/info and common capabilities) but can be narrowed via tool calls or CLI flags.
