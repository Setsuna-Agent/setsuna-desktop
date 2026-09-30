import { describe, expect, it } from 'vitest';
import { scheduleTimeParts, updateScheduleTime } from '../../src/renderer/schedule-time-input.js';

describe('schedule time editing', () => {
  it('keeps the day in the selected month instead of overflowing into the next month', () => {
    expect(updateScheduleTime('2026-01-31T10:51', 'month', 2)).toBe('2026-02-28T10:51');
    expect(updateScheduleTime('2026-03-31T10:51', 'month', 4)).toBe('2026-04-30T10:51');
  });

  it('clamps leap day when switching to a non-leap year, including century boundaries', () => {
    expect(updateScheduleTime('2024-02-29T10:51', 'year', 2025)).toBe('2025-02-28T10:51');
    expect(updateScheduleTime('2096-02-29T10:51', 'year', 2100)).toBe('2100-02-28T10:51');
    expect(updateScheduleTime('2396-02-29T10:51', 'year', 2400)).toBe('2400-02-29T10:51');
  });

  it('preserves local date fields and minute precision while changing the clock', () => {
    expect(scheduleTimeParts('2026-09-30T10:51')).toEqual({ date: { year: 2026, month: 9, day: 30 }, hour: 10, minute: 51 });
    expect(updateScheduleTime('2026-09-30T10:51', 'hour', 0)).toBe('2026-09-30T00:51');
    expect(updateScheduleTime('2026-09-30T10:51', 'minute', 7)).toBe('2026-09-30T10:07');
  });

  it('edits recurring clock values without adding a date or converting the timezone', () => {
    expect(updateScheduleTime('23:51', 'hour', 9)).toBe('09:51');
    expect(updateScheduleTime('09:51', 'minute', 0)).toBe('09:00');
  });
});
