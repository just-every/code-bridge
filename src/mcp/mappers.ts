import type { BridgeEvent } from '../types';
import type { BufferedEvent, BridgeMeta } from './types';

export function toJsonContent(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function projectMetadata(meta: BridgeMeta) {
  return toJsonContent('bridge://metadata', {
    url: meta.url,
    secret: '[redacted]',
    port: meta.port,
    workspacePath: meta.workspacePath,
    pid: meta.pid,
    heartbeatAt: meta.heartbeatAt,
    startedAt: meta.startedAt,
  });
}

export function projectStats(events: BufferedEvent[]) {
  const errorCount = events.filter((e) => e.level === 'error').length;
  const byType: Record<string, number> = {};
  events.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + 1; });
  return toJsonContent('bridge://stats', {
    total: events.length,
    errors: errorCount,
    byType,
    lastEventId: events.length ? events[events.length - 1].__id : 0,
  });
}
