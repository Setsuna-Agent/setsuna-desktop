import { afterEach, describe, expect, it, vi } from 'vitest';
import { automationScheduleCodec } from '../../src/contracts/index.js';
import { nextAutomationRun } from '../../src/runtime/schedule.js';

afterEach(() => vi.restoreAllMocks());

describe('automation scheduling', () => {
  it('defaults all calendar repeat rules to the machine clock without a user timezone', () => {
    const options = Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...options, timeZone: 'America/New_York' });
    for (const kind of ['daily', 'weekdays', 'weekly', 'custom']) {
      const schedule = automationScheduleCodec.parse({ kind, time: '09:00', weekdays: [3] });
      expect(nextAutomationRun(schedule, new Date('2026-09-30T12:59:00Z'))).toBe('2026-09-30T13:00:00.000Z');
    }
  });

  it('honors local calendar dates, month boundaries and exact time boundaries', () => {
    const schedule = { kind: 'daily' as const, time: '09:00', timeZone: 'Asia/Shanghai' };
    expect(nextAutomationRun(schedule, new Date('2026-09-30T00:59:59Z'))).toBe('2026-09-30T01:00:00.000Z');
    expect(nextAutomationRun(schedule, new Date('2026-09-30T01:00:00Z'))).toBe('2026-10-01T01:00:00.000Z');
  });

  it('skips weekends and applies selected weekdays in the configured timezone', () => {
    expect(nextAutomationRun({ kind: 'weekdays', time: '09:00', timeZone: 'Asia/Shanghai' }, new Date('2026-10-02T02:00:00Z'))).toBe('2026-10-05T01:00:00.000Z');
    expect(nextAutomationRun({ kind: 'custom', time: '23:00', timeZone: 'Asia/Shanghai', weekdays: [0, 3] }, new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-04T15:00:00.000Z');
  });

  it('skips nonexistent spring times and runs an ambiguous autumn time only once', () => {
    expect(nextAutomationRun({ kind: 'daily', time: '02:30', timeZone: 'America/New_York' }, new Date('2026-03-08T05:00:00Z'))).toBe('2026-03-09T06:30:00.000Z');
    const autumn = { kind: 'daily' as const, time: '01:30', timeZone: 'America/New_York' };
    expect(nextAutomationRun(autumn, new Date('2026-11-01T04:00:00Z'))).toBe('2026-11-01T05:30:00.000Z');
    expect(nextAutomationRun(autumn, new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-02T06:30:00.000Z');
  });

  it('keeps interval cadence after long downtime without scheduling a catch-up storm', () => {
    expect(nextAutomationRun({ kind: 'interval', minutes: 10 }, new Date('2026-09-30T03:07:00Z'), '2026-09-30T01:00:00Z')).toBe('2026-09-30T03:10:00.000Z');
    expect(nextAutomationRun({ kind: 'once', at: '2026-09-30T01:00:00Z' }, new Date('2026-09-30T01:00:00Z'))).toBeNull();
  });

  it('handles weekly clock gaps and timezone transitions that shift by half an hour', () => {
    expect(nextAutomationRun({ kind: 'weekly', time: '02:30', timeZone: 'America/New_York', weekdays: [0] }, new Date('2026-03-01T08:00:00Z'))).toBe('2026-03-15T06:30:00.000Z');
    const schedule = { kind: 'daily' as const, time: '01:45', timeZone: 'Australia/Lord_Howe' };
    expect(nextAutomationRun(schedule, new Date('2026-04-04T13:00:00Z'))).toBe('2026-04-04T14:45:00.000Z');
    expect(nextAutomationRun(schedule, new Date('2026-04-04T14:45:00Z'))).toBe('2026-04-05T15:15:00.000Z');
  });

  it.each([
    { kind: 'interval', minutes: 0 }, { kind: 'interval', minutes: 1.5 },
    { kind: 'daily', time: '25:00', timeZone: 'Asia/Shanghai' },
    { kind: 'daily', time: '09:00', timeZone: 'Invalid/Zone' },
    { kind: 'weekly', time: '09:00', timeZone: 'UTC', weekdays: [1, 2] },
    { kind: 'custom', time: '09:00', timeZone: 'UTC', weekdays: [] },
    { kind: 'once', at: '2026-09-30T09:00:00' },
    { kind: 'once', at: '2026-02-30T09:00:00Z' },
  ])('rejects invalid timing input before persistence: %j', (schedule) => {
    expect(() => automationScheduleCodec.parse(schedule)).toThrow();
  });
});
