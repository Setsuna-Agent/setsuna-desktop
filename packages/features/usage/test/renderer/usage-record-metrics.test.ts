import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { usageOutputSpeed } from '../../src/renderer/usage/usageRecordMetrics.js';

describe('request output speed', () => {
  it('uses the whole request duration and refuses aggregate or unavailable timing', () => {
    const record: RuntimeUsageRecord = {
      id: 'usage_1', threadId: 'thread_1', turnId: 'turn_1', createdAt: '',
      requestCount: 1, outputTokens: 75, durationMs: 1500,
    };
    expect(usageOutputSpeed(record)).toBe(50);
    for (const patch of [{ requestCount: 2 }, { durationMs: undefined }, { outputTokens: undefined }, { durationMs: 0 }]) {
      expect(usageOutputSpeed({ ...record, ...patch })).toBeUndefined();
    }
  });
});
