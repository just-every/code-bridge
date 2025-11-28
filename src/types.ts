export type Platform = 'web' | 'node' | 'react-native' | 'unknown';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type SubscriptionLevel = 'errors' | 'warn' | 'info' | 'trace';

export type BridgeCapability = 'error' | 'console' | 'pageview' | 'screenshot' | 'control';

export interface BridgeEvent {
  type: 'error' | 'log' | 'console' | 'pageview' | 'screenshot';
  level: LogLevel;
  message: string;
  stack?: string;
  timestamp: number;
  platform: Platform;
  projectId?: string;
  breadcrumbs?: Breadcrumb[];
  url?: string;
  route?: string;
  mime?: string; // for screenshots
  data?: string; // base64 body for screenshots
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
  enablePageview?: boolean;
  enableScreenshot?: boolean;
  enableControl?: boolean;
}

export interface BridgeConnection {
  disconnect: () => void;
  trackPageview: (params: { url?: string; route?: string }) => void;
  sendScreenshot: (params: { mime: string; data: string; url?: string; route?: string }) => void;
  onControl: (handler: (msg: any) => void) => void;
}

// Protocol message types for host-bridge-consumer communication
export interface HelloMessage {
  type: 'hello';
  capabilities: BridgeCapability[];
  platform: Platform;
  projectId?: string;
  route?: string;
  url?: string;
}

export interface SubscribeMessage {
  type: 'subscribe';
  levels: SubscriptionLevel[];
  capabilities?: BridgeCapability[];
}
