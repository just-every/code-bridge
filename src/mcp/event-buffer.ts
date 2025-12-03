import type { BridgeEvent } from '../types';
import type { BufferedEvent } from './types';

export class EventBuffer {
  private readonly limit: number;
  private counter = 0;
  private events: BufferedEvent[] = [];

  constructor(limit = 500) {
    this.limit = Math.max(1, limit);
  }

  push(event: BridgeEvent): BufferedEvent {
    const buffered: BufferedEvent = { ...event, __id: ++this.counter };
    this.events.push(buffered);
    if (this.events.length > this.limit) {
      this.events = this.events.slice(-this.limit);
    }
    return buffered;
  }

  recent(max = 100): BufferedEvent[] {
    return this.events.slice(-max);
  }

  errors(max = 50): BufferedEvent[] {
    return this.events.filter((e) => e.level === 'error').slice(-max);
  }

  network(max = 50): BufferedEvent[] {
    return this.events.filter((e) => e.type === 'network').slice(-max);
  }

  navigation(max = 50): BufferedEvent[] {
    return this.events.filter((e) => e.type === 'navigation' || e.type === 'pageview').slice(-max);
  }

  latestScreenshot(): BufferedEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (this.events[i].type === 'screenshot') return this.events[i];
    }
    return undefined;
  }

  stats() {
    return {
      totalEvents: this.events.length,
      errorCount: this.events.filter((e) => e.level === 'error').length,
      lastId: this.events.length ? this.events[this.events.length - 1].__id : 0,
    };
  }
}
