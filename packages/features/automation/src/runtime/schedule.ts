import type { AutomationSchedule } from '../contracts/index.js';

/** Always returns a future occurrence. Missed recurring runs collapse to one dispatch. */
export function nextAutomationRun(schedule: AutomationSchedule, after: Date, previous?: string): string | null {
  if (schedule.kind === 'once') return Date.parse(schedule.at) > after.getTime() ? schedule.at : null;
  if (schedule.kind === 'interval') {
    const period = schedule.minutes * 60_000;
    const anchor = previous ? Date.parse(previous) : after.getTime();
    return new Date(anchor + Math.max(1, Math.floor((after.getTime() - anchor) / period) + 1) * period).toISOString();
  }
  const local = localParts(after, schedule.timeZone);
  const [hour, minute] = schedule.time.split(':').map(Number);
  const days = schedule.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6]
    : 'weekdays' in schedule ? schedule.weekdays : [1, 2, 3, 4, 5];
  // A weekly occurrence inside a spring clock gap may need the following week.
  for (let offset = 0; offset < 16; offset += 1) {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    if (!days.includes(day.getUTCDay())) continue;
    const target = { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour, minute };
    const instant = wallTimeToInstant(target, schedule.timeZone);
    if (instant && instant.getTime() > after.getTime()) return instant.toISOString();
  }
  throw new Error('Could not find the next scheduled time.');
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

function asUtc(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function wallTimeToInstant(target: LocalParts, timeZone: string): Date | null {
  const wall = asUtc(target);
  // Inspect both sides of a timezone transition instead of assuming a one-hour
  // shift. Ambiguous times choose the earlier instant; nonexistent times skip.
  const offsets = new Set([-86_400_000, 0, 86_400_000].map((delta) => {
    const probe = wall + delta;
    return asUtc(localParts(new Date(probe), timeZone)) - probe;
  }));
  const candidates = [...offsets].map((offset) => wall - offset)
    .filter((candidate) => asUtc(localParts(new Date(candidate), timeZone)) === wall);
  return candidates.length ? new Date(Math.min(...candidates)) : null;
}
