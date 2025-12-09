import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';

import {
  PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  BUFFER_LIMIT,
} from '../constants';
import { BridgeWebSocket } from '../websocket';

const fixturesDir = path.resolve(__dirname, '../../protocol/fixtures');
const schemaPath = path.resolve(__dirname, '../../protocol/schema.json');

describe('protocol fixtures', () => {
  const ajv = new Ajv({ allErrors: true });
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);

  const fixtureNames = fs
    .readdirSync(fixturesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  for (const name of fixtureNames) {
    it(`validates fixture ${name}`, () => {
      const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
      const ok = validate(raw);
      if (!ok) {
        const message = ajv.errorsText(validate.errors, { separator: '\n' });
        throw new Error(`Fixture ${name} failed schema validation:\n${message}`);
      }
      expect(ok).toBe(true);
    });
  }

  it('exposes protocol version constant', () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });
});

describe('shared runtime constants', () => {
  it('heartbeat timeout remains larger than interval', () => {
    expect(HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(HEARTBEAT_INTERVAL_MS);
  });

  it('BridgeWebSocket uses centralized constants', async () => {
    const ws = new BridgeWebSocket('ws://localhost', 'secret', ['console'], 'web');
    expect((ws as any).heartbeatIntervalMs).toBe(HEARTBEAT_INTERVAL_MS);
    expect((ws as any).heartbeatTimeoutMs).toBe(HEARTBEAT_TIMEOUT_MS);
    expect((ws as any).bufferLimit).toBe(BUFFER_LIMIT);
    expect((ws as any).reconnectDelay).toBe(RECONNECT_INITIAL_DELAY_MS);
    expect((ws as any).maxReconnectDelay).toBe(RECONNECT_MAX_DELAY_MS);
  });
});
