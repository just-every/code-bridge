# Code Bridge Protocol

This folder holds the source of truth for the wire protocol shared by all Code Bridge SDKs.

- `schema.json` — JSON Schema for protocol v2 (auth, hello, ping/pong, control request/result).
- `fixtures/` — Golden messages used by SDK conformance tests.
- `PROTOCOL_VERSION` — exported from `src/constants.ts` and embedded in hello frames.

## Frames

- `auth` — client → host, includes `secret` and `role` (`bridge` or `consumer`).
- `hello` — client → host after auth success; declares `capabilities`, `platform`, `projectId`, `protocol`.
- `ping` / `pong` — heartbeat frames; timeout must be greater than interval.
- `control_request` / `control_result` — host ⇄ bridge control plane.

See `schema.json` for field-level requirements and `fixtures/` for concrete examples. New language SDKs should validate against the schema and exercise the fixtures in CI to guarantee compatibility.
