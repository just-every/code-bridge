# PHP Quickstart (skeleton)

## Install
Registry: `composer require just-every/code-bridge-php` (after publishing)
Dev: `cd php && composer install`
One-liner dev: `npm run sdk:php`

## Configure
Set `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` (e.g., with `.env` or environment variables).

## Initialize
Create a client with `url`, `secret`, optional `projectId`, and desired `capabilities`.

## Send First Event
Send a simple console/log event (level/message) and ensure it uses the protocol `hello` with `protocol` version.

## Verify
Run the host or `npm run protocol:test-server`; confirm the event arrives.

## Next Steps
Integrate with your framework/logger, add error capture, and wire control handlers as needed.
