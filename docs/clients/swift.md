# Swift Quickstart (skeleton)

## Install
Registry: add SPM URL `https://github.com/just-every/code-bridge.git` (tagged release)
Dev: `cd swift && swift build`
One-liner dev (macOS): `npm run sdk:swift`

## Configure
Provide `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` via environment/Info.plist; keep secrets secure in apps.

## Initialize
Create/start a client (async/await), sending `auth` and `hello` with `protocol` version and capabilities.

## Send First Event
Send a log/pageview event when a view appears; heartbeat should be active.

## Verify
Run host or `npm run protocol:test-server`; confirm the event is logged.

## Next Steps
Hook into OSLog/crash handlers, add control handlers, and enable screenshot capture where supported.
