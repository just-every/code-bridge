# Java Quickstart (skeleton)

## Install
Registry: Maven/Gradle (after publishing):
```
<dependency>
  <groupId>com.jestevery</groupId>
  <artifactId>code-bridge-java</artifactId>
  <version>0.1.0</version>
</dependency>
```
Dev: `cd java && mvn -q compile`
One-liner dev: `npm run sdk:java`

## Configure
Set `CODE_BRIDGE_URL` and `CODE_BRIDGE_SECRET` via env vars or system properties.

## Initialize
Create/start the client, send `auth` then `hello` with capabilities and shared `protocol` version.

## Send First Event
Send a console/log event; ensure buffering/reconnect are enabled.

## Verify
Run host or `npm run protocol:test-server`; observe event output.

## Next Steps
Integrate with SLF4J/Logback appenders, add control handlers, and wire into app shutdown hooks.
