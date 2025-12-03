#!/usr/bin/env node

// Thin wrapper that loads the built MCP stdio server.
// Build output lives in dist/mcp/cli.js (tsup config).

require('../dist/mcp/cli.js');
