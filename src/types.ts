export type Platform = 'web' | 'node' | 'react-native' | 'worker' | 'roblox' | 'unknown';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type SubscriptionLevel = 'errors' | 'warn' | 'info' | 'trace';

export type BridgeCapability =
  | 'error'
  | 'console'
  | 'pageview'
  | 'navigation'
  | 'screenshot'
  | 'network'
  | 'control';

export type BridgeEventType =
  | 'error'
  | 'log'
  | 'console'
  | 'pageview'
  | 'navigation'
  | 'screenshot'
  | 'network';

export interface NetworkInfo {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  requestSize?: number;
  responseSize?: number;
  transport?: 'fetch' | 'xhr' | 'http' | 'https';
  errorMessage?: string;
}

export interface NavigationInfo {
  from?: string;
  to: string;
  route?: string;
  initiator: 'load' | 'pushState' | 'replaceState' | 'popstate' | 'hashchange';
}

export interface BridgeEvent {
  type: BridgeEventType;
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
  args?: any[]; // raw console args (serialized)
  navigation?: NavigationInfo;
  network?: NetworkInfo;
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
  enableNavigation?: boolean;
  enableNetwork?: boolean;
  enableScreenshot?: boolean;
  screenshotProvider?: () => Promise<{ mime: string; data: string }>;
  enableControl?: boolean;
}

export interface BridgeConnection {
  disconnect: () => void;
  trackPageview: (params: { url?: string; route?: string }) => void;
  trackNavigation: (info: NavigationInfo) => void;
  sendScreenshot: (params: { mime: string; data: string; url?: string; route?: string }) => void;
  onControl: (handler: (msg: ControlRequestMessage) => Promise<any> | any) => void;
}

// Protocol message types for host-bridge-consumer communication
export interface HelloMessage {
  type: 'hello';
  capabilities: BridgeCapability[];
  platform: Platform;
  projectId?: string;
  route?: string;
  url?: string;
  protocol?: number;
}

export interface SubscribeMessage {
  type: 'subscribe';
  levels: SubscriptionLevel[];
  capabilities?: BridgeCapability[];
  llm_filter?: 'off' | 'minimal' | 'aggressive';
}

export interface ControlRequestMessage {
  type: 'control_request';
  id: string;
  action: string;
  args?: any;
  // Optional eval helper for JS execution in dev tooling
  code?: string;
  expectResult?: boolean;
  timeoutMs?: number;
}

export interface ControlResultMessage {
  type: 'control_result';
  id: string;
  ok: boolean;
  result?: any;
  error?: { message: string; stack?: string };
}

export type ProtocolMessage =
  | HelloMessage
  | SubscribeMessage
  | ControlRequestMessage
  | ControlResultMessage
  | BridgeEvent;
