import { describe, expect, it } from 'vitest';
import {
  defaultUsageCustomTimeRange,
  formatUsageCustomTimeValue,
  usageQueryForCustomRange,
  usageQueryForPreset,
} from '../../src/renderer/usage/usageTimeRange.js';

describe('usage time ranges', () => {
  it('uses the local calendar-day boundary for today and rolling hours for other presets', () => {
    const now = new Date(2026, 7, 13, 15, 42, 35, 400);

    expect(usageQueryForPreset('today', now)).toEqual({
      from: new Date(2026, 7, 13, 0, 0, 0, 0).toISOString(),
      to: now.toISOString(),
    });
    expect(Date.parse(usageQueryForPreset('24h', now).from ?? '')).toBe(now.getTime() - 24 * 60 * 60 * 1000);
    expect(Date.parse(usageQueryForPreset('7d', now).from ?? '')).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(Date.parse(usageQueryForPreset('30d', now).from ?? '')).toBe(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  });

  it('includes the complete selected end minute without exposing seconds', () => {
    const query = usageQueryForCustomRange({
      from: '2026-08-13T09:05',
      to: '2026-08-13T10:30',
    });

    expect(query).toEqual({
      from: new Date(2026, 7, 13, 9, 5).toISOString(),
      to: new Date(2026, 7, 13, 10, 31).toISOString(),
    });
    expect(formatUsageCustomTimeValue(new Date(2026, 7, 13, 10, 30, 59))).toBe('2026/08/13 10:30');
    expect(defaultUsageCustomTimeRange(new Date(2026, 7, 13, 10, 30, 59))).toEqual({
      from: '2026/08/12 10:30',
      to: '2026/08/13 10:30',
    });
  });

  it('rejects invalid and reversed custom ranges', () => {
    expect(usageQueryForCustomRange({ from: '', to: '2026-08-13T10:30' })).toBeNull();
    expect(usageQueryForCustomRange({
      from: '2026-08-13T10:31',
      to: '2026-08-13T10:30',
    })).toBeNull();
    expect(usageQueryForCustomRange({
      from: '2026-02-30T10:00',
      to: '2026-03-01T10:00',
    })).toBeNull();
  });
});
