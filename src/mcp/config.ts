import fs from 'fs';
import path from 'path';
import type { BridgeCapability, SubscriptionLevel } from '../types';
import type { BridgeMeta, LlmFilter, McpOptions, ResolvedMcpConfig } from './types';

const DEFAULT_LEVELS: SubscriptionLevel[] = ['errors', 'warn', 'info'];
const DEFAULT_CAPABILITIES: BridgeCapability[] = ['error', 'console', 'pageview', 'navigation', 'network', 'screenshot', 'control'];
const DEFAULT_BUFFER_SIZE = 500;

function readMetaFile(workspacePath: string): BridgeMeta | null {
  const metaPath = path.join(workspacePath, '.code', 'code-bridge.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as BridgeMeta;
    parsed.workspacePath = workspacePath;
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse ${metaPath}: ${(err as Error).message}`);
  }
}

export function resolveMcpConfig(options: McpOptions = {}): ResolvedMcpConfig {
  const workspace = options.workspacePath || process.env.CODE_BRIDGE_WORKSPACE || process.cwd();
  const envUrl = process.env.CODE_BRIDGE_URL;
  const envSecret = process.env.CODE_BRIDGE_SECRET;

  const metaFromDisk = readMetaFile(workspace);

  const meta: BridgeMeta = {
    url: options.hostUrl || envUrl || metaFromDisk?.url || '',
    secret: options.secret || envSecret || metaFromDisk?.secret || '',
    port: metaFromDisk?.port,
    workspacePath: metaFromDisk?.workspacePath || workspace,
    pid: metaFromDisk?.pid,
    heartbeatAt: metaFromDisk?.heartbeatAt,
    startedAt: metaFromDisk?.startedAt,
  };

  if (!meta.url || !meta.secret) {
    throw new Error('Unable to resolve code-bridge host metadata (url + secret). Run `code-bridge-host` first or provide --url/--secret.');
  }

  const levels = normalizeLevels(options.subscription?.levels || DEFAULT_LEVELS);
  const capabilities = normalizeCapabilities(options.subscription?.capabilities || DEFAULT_CAPABILITIES);
  const llm_filter: LlmFilter | undefined = options.subscription?.llm_filter || 'off';
  const bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;

  return {
    meta,
    clientId: options.clientId || `mcp-${process.pid}`,
    bufferSize,
    debug: Boolean(options.debug),
    subscription: { levels, capabilities, llm_filter },
  };
}

function normalizeLevels(levels: SubscriptionLevel[]): SubscriptionLevel[] {
  const allowed: SubscriptionLevel[] = ['errors', 'warn', 'info', 'trace'];
  const set = new Set<SubscriptionLevel>();
  levels.forEach((lvl) => {
    if (allowed.includes(lvl)) set.add(lvl);
  });
  return Array.from(set.size ? set : new Set(['errors']));
}

function normalizeCapabilities(caps: BridgeCapability[]): BridgeCapability[] {
  const allowed: BridgeCapability[] = ['error', 'console', 'pageview', 'navigation', 'screenshot', 'network', 'control'];
  const set = new Set<BridgeCapability>();
  caps.forEach((cap) => {
    if (allowed.includes(cap)) set.add(cap);
  });
  return Array.from(set.size ? set : new Set(['error', 'console']));
}
