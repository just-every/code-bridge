#!/usr/bin/env node
import path from 'path';
import { startMcpServer } from './server';
import type { McpOptions } from './types';

function parseArgs(argv: string[]): McpOptions {
  const opts: McpOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--workspace' || arg === '-w') {
      opts.workspacePath = argv[++i];
    } else if (arg === '--url') {
      opts.hostUrl = argv[++i];
    } else if (arg === '--secret') {
      opts.secret = argv[++i];
    } else if (arg === '--client-id') {
      opts.clientId = argv[++i];
    } else if (arg === '--levels') {
      opts.subscription = opts.subscription || {};
      opts.subscription.levels = argv[++i].split(',') as any;
    } else if (arg === '--capabilities') {
      opts.subscription = opts.subscription || {};
      opts.subscription.capabilities = argv[++i].split(',') as any;
    } else if (arg === '--llm-filter') {
      opts.subscription = opts.subscription || {};
      opts.subscription.llm_filter = argv[++i] as any;
    } else if (arg === '--buffer-size') {
      opts.bufferSize = Number(argv[++i]);
    } else if (arg === '--debug') {
      opts.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`code-bridge-mcp

Usage: code-bridge-mcp [options]

Options:
  -w, --workspace <path>   Workspace path (defaults to cwd)
      --url <ws://...>      Override host WebSocket URL
      --secret <secret>     Override host secret
      --levels a,b,c        Subscription levels (errors,warn,info,trace)
      --capabilities list   Capabilities filter (comma-separated)
      --llm-filter value    off|minimal|aggressive
      --buffer-size n       Max buffered events (default 500)
      --client-id id        Client id for the consumer
      --debug               Verbose logging
  -h, --help                Show help
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = opts.workspacePath ? path.resolve(opts.workspacePath) : process.cwd();
  if (!opts.workspacePath) opts.workspacePath = cwd;

  // eslint-disable-next-line no-console
  console.error(`[code-bridge-mcp] workspace=${opts.workspacePath}`);

  const server = await startMcpServer(opts);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[code-bridge-mcp] failed to start:', err.message);
  process.exit(1);
});
