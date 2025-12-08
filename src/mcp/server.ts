import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { BridgeEvent } from '../types';
import { resolveMcpConfig } from './config';
import { EventBuffer } from './event-buffer';
import { HostConsumer } from './consumer';
import { projectMetadata, projectStats, toJsonContent } from './mappers';
import type { McpOptions } from './types';
import { KNOWN_RESOURCES } from './types';
import { validateControlArgs, validateSubscribeArgs } from './validation';

import { getEnv } from '../platform';

const VERSION = getEnv('npm_package_version') || '0.0.0';

export interface McpServer {
  stop: () => Promise<void>;
}

export async function startMcpServer(options: McpOptions = {}): Promise<McpServer> {
  const config = resolveMcpConfig(options);
  const consumer = new HostConsumer(config.meta, config.clientId, config.debug);
  await consumer.connect();

  await consumer.subscribe({
    type: 'subscribe',
    levels: config.subscription.levels,
    capabilities: config.subscription.capabilities,
    llm_filter: config.subscription.llm_filter,
  });

  const buffer = new EventBuffer(config.bufferSize);

  const server = new Server({
    name: 'code-bridge-mcp',
    version: VERSION,
  }, {
    capabilities: {
      resources: { subscribe: true },
      tools: {},
    },
  });

  // Event forwarding
  consumer.on('bridge-event', (event: BridgeEvent) => {
    buffer.push(event);
    server.notification({ method: 'bridge/event', params: event as any });
    notifyResourceUpdates(server, event.type);
  });

  // Control results back to tools
  consumer.on('control-result', (result) => {
    server.notification({ method: 'bridge/control_result', params: result as any });
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceList(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    switch (uri) {
      case 'bridge://metadata':
        return projectMetadata(config.meta);
      case 'bridge://events/recent':
        return toJsonContent(uri, buffer.recent());
      case 'bridge://events/errors':
        return toJsonContent(uri, buffer.errors());
      case 'bridge://events/network':
        return toJsonContent(uri, buffer.network());
      case 'bridge://events/navigation':
        return toJsonContent(uri, buffer.navigation());
      case 'bridge://events/screenshot': {
        const latest = buffer.latestScreenshot();
        return toJsonContent(uri, latest ? latest : { message: 'No screenshots captured yet' });
      }
      case 'bridge://stats':
        return projectStats(buffer.recent());
      default:
        throw new Error(`Unknown resource uri: ${uri}`);
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'subscribe_to_events',
        description: 'Update host subscription levels/capabilities/llm_filter',
        inputSchema: {
          type: 'object',
          properties: {
            levels: { type: 'array', items: { type: 'string' } },
            capabilities: { type: 'array', items: { type: 'string' } },
            llm_filter: { type: 'string' },
          },
        },
      },
      {
        name: 'send_control',
        description: 'Forward a control request to connected bridges',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            args: { type: 'object' },
            code: { type: 'string' },
            timeoutMs: { type: 'number' },
            expectResult: { type: 'boolean' },
          },
          required: ['action'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name === 'subscribe_to_events') {
      const parsed = validateSubscribeArgs(args);
      await consumer.subscribe({ type: 'subscribe', ...parsed });
      return { content: [{ type: 'text', text: 'subscription updated' }] };
    }
    if (name === 'send_control') {
      const parsed = validateControlArgs(args);
      const id = `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const result = await consumer.sendControl(id, parsed.action, parsed.args ?? parsed.code, parsed.timeoutMs);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = (options.transport as any) || new StdioServerTransport();
  await server.connect(transport);

  const stop = async () => {
    consumer.close();
    await server.close();
  };

  return { stop };
}

function resourceList() {
  return KNOWN_RESOURCES.map((uri) => ({
    uri,
    name: uri.replace('bridge://', ''),
    mimeType: 'application/json',
  }));
}

function notifyResourceUpdates(server: Server, type: BridgeEvent['type']) {
  const uris: string[] = ['bridge://events/recent', 'bridge://stats'];
  if (type === 'error') uris.push('bridge://events/errors');
  if (type === 'network') uris.push('bridge://events/network');
  if (type === 'navigation' || type === 'pageview') uris.push('bridge://events/navigation');
  if (type === 'screenshot') uris.push('bridge://events/screenshot');

  uris.forEach((uri) => server.notification({ method: 'notifications/resources/updated', params: { uri } }));
}
