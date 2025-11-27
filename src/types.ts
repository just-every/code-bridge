export type Platform = 'web' | 'node' | 'react-native' | 'unknown';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface BridgeEvent {
  type: 'error' | 'log' | 'console';
  level: LogLevel;
  message: string;
  stack?: string;
  timestamp: number;
  platform: Platform;
  projectId?: string;
  breadcrumbs?: Breadcrumb[];
}

export interface Breadcrumb {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface BridgeOptions {
  url?: string;
  port?: number;
  secret?: string;
  projectId?: string;
  maxBreadcrumbs?: number;
  throttleMs?: number;
  enabled?: boolean;
}

export interface BridgeConnection {
  disconnect: () => void;
}
