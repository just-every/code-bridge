import { describe, it, expect } from 'vitest';
import { EventBuffer } from '../mcp/event-buffer';

const baseEvent = {
  type: 'log',
  level: 'info',
  message: 'test',
  timestamp: Date.now(),
  platform: 'node',
} as const;

describe('EventBuffer', () => {
  it('stores and trims events', () => {
    const buffer = new EventBuffer(2);
    buffer.push({ ...baseEvent, message: 'a' } as any);
    buffer.push({ ...baseEvent, message: 'b' } as any);
    buffer.push({ ...baseEvent, message: 'c' } as any);

    const recent = buffer.recent();
    expect(recent).toHaveLength(2);
    expect(recent[0].message).toBe('b');
    expect(recent[1].message).toBe('c');
  });

  it('filters errors and network', () => {
    const buffer = new EventBuffer(10);
    buffer.push({ ...baseEvent, type: 'error', level: 'error' } as any);
    buffer.push({ ...baseEvent, type: 'network', level: 'info' } as any);

    expect(buffer.errors()).toHaveLength(1);
    expect(buffer.network()).toHaveLength(1);
  });

  it('finds latest screenshot', () => {
    const buffer = new EventBuffer(5);
    buffer.push({ ...baseEvent, type: 'screenshot', message: 'shot1', mime: 'image/png', data: 'abc' } as any);
    buffer.push({ ...baseEvent, type: 'log', message: 'other' } as any);
    const latest = buffer.latestScreenshot();
    expect(latest?.message).toBe('shot1');
  });
});
