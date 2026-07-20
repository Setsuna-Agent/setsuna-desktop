import type { RuntimeUsageBucket } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { buildUsageCalendar, USAGE_CALENDAR_WEEK_COUNT } from './usageCalendar.js';

describe('buildUsageCalendar', () => {
  it('builds a fixed rolling year and derives activity levels', () => {
    const calendar = buildUsageCalendar([
      usageDay('2025-07-20', 900, 1),
      usageDay('2026-07-19', 100, 2),
      usageDay('2026-07-20', 400, 3),
    ], new Date(2026, 6, 20, 12));
    const days = calendar.weeks.flat();

    expect(calendar.weeks).toHaveLength(USAGE_CALENDAR_WEEK_COUNT);
    expect(calendar.weeks.every((week) => week.length === 7)).toBe(true);
    expect(calendar.activeDays).toBe(2);
    expect(calendar.periodTokens).toBe(500);
    expect(calendar.averageTokensPerActiveDay).toBe(250);
    expect(days.find((day) => day.dateKey === '2025-07-20')?.isInRange).toBe(false);
    expect(days.find((day) => day.dateKey === '2026-07-19')?.level).toBe(1);
    expect(days.find((day) => day.dateKey === '2026-07-20')?.level).toBe(4);
    expect(calendar.months.some((month) => month.label === '7月')).toBe(true);
  });

  it('merges duplicate dates and treats zero-token calls as activity', () => {
    const calendar = buildUsageCalendar([
      usageDay('2026-07-20', 0, 1),
      usageDay('2026-07-20', 0, 2),
      usageDay('not-a-date', 100, 1),
    ], new Date(2026, 6, 20, 12));
    const today = calendar.weeks.flat().find((day) => day.dateKey === '2026-07-20');

    expect(calendar.activeDays).toBe(1);
    expect(today).toMatchObject({ level: 1, recordCount: 3, totalTokens: 0 });
  });
});

function usageDay(key: string, totalTokens: number, recordCount: number): RuntimeUsageBucket {
  return {
    key,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    recordCount,
    totalTokens,
  };
}
