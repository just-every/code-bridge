import type {
  BridgeCapability,
  BridgeEvent,
  ControlResultMessage,
  SubscriptionLevel,
} from '../types';

export type LlmFilter = 'off' | 'minimal' | 'aggressive';

export interface BridgeMeta {
  url: string;
  secret: string;
  port?: number;
  workspacePath?: string;
  pid?: number;
  heartbeatAt?: string;
  startedAt?: string;
}

export interface McpOptions {
  workspacePath?: string;
  hostUrl?: string;
  secret?: string;
  clientId?: string;
  bufferSize?: number;
  debug?: boolean;
  transport?: unknown; // Optional custom transport override (used in tests)
  subscription?: {
    levels?: SubscriptionLevel[];
    capabilities?: BridgeCapability[];
    llm_filter?: LlmFilter;
  };
}

export interface ResolvedMcpConfig {
  meta: BridgeMeta;
  clientId: string;
  bufferSize: number;
  debug: boolean;
  subscription: {
    levels: SubscriptionLevel[];
    capabilities?: BridgeCapability[];
    llm_filter?: LlmFilter;
  };
}

export interface BufferedEvent extends BridgeEvent {
  __id: number;
}

export interface ControlResultEnvelope extends ControlResultMessage {
  receivedAt: number;
}

export type KnownResourceUri =
  | 'bridge://metadata'
  | 'bridge://events/recent'
  | 'bridge://events/errors'
  | 'bridge://events/network'
  | 'bridge://events/navigation'
  | 'bridge://events/screenshot'
  | 'bridge://stats';

export const KNOWN_RESOURCES: KnownResourceUri[] = [
  'bridge://metadata',
  'bridge://events/recent',
  'bridge://events/errors',
  'bridge://events/network',
  'bridge://events/navigation',
  'bridge://events/screenshot',
  'bridge://stats',
];
