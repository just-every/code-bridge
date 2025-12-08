# Language clients

Code Bridge supports multiple platforms via per-language clients. Every client talks to the same host transport (WS or HTTP), authenticates with the shared secret, sends a `hello` with capabilities + platform, and streams events (plus optional control) in the same shapes. Keep clients dev-only and vendor them into the target app.

## Directory/layout pattern
- One folder per ecosystem at repo root (e.g., `lua/`, `python/`, `dotnet/`).
- Client-specific guide lives in `docs/<language>.md` (e.g., `docs/roblox.md`).
- Ecosystem-specific packaging/publishing (pip/npm/nuget/etc.) stays within that ecosystem; this repo keeps the canonical sources and minimal tooling (like the Lua copy helper).

## Roblox / Lua (HTTP)
- Use when WebSockets are unavailable (Roblox Studio).
- Client file: `lua/CodeBridge.lua` (Studio-only by default; batched HttpService posts; control polling).
- Integration guide: `docs/roblox.md`.
- To vendor into a game: `npm run copy:lua-client -- <dest-file>` (e.g., `npm run copy:lua-client -- ../my-game/src/ReplicatedStorage/CodeBridge/CodeBridge.lua`).

## Adding another language
1) Create `<language>/` with the client source.
2) Write `docs/<language>.md` covering setup, dev-only guardrails, and how to connect to the host (secret + hello + events + optional control/screenshot).
3) If applicable, add a small helper script under `tools/` for that ecosystem (optional) to ease vendoring.
4) Document the new client in this file with a short section and a link to its doc.
