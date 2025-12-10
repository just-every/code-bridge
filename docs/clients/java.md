# Java Quickstart

Status: **Experimental scaffold** — source code not yet implemented. Use another SDK for production; keep this page as the intended shape.

## Planned install
Maven/Gradle (once published):
```xml
<dependency>
  <groupId>com.jestevery</groupId>
  <artifactId>code-bridge-java</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Current state
- No Java sources are present yet; `npm run sdk:java` currently runs the placeholder Maven project.
- Target API will mirror other SDKs: `start()` / `stop()`, `sendConsole(level, message)`, `sendError(message)`, protocol 2 hello, and optional heartbeat/reconnect.

## What you can do now
- Use the JS, Python, Go, or Swift SDKs for JVM-adjacent tooling.
- Track progress in the repo; once implementation lands, this doc will include runnable snippets similar to other languages.
