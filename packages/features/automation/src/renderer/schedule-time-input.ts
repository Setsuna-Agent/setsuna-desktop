type CalendarParts = { year: number; month: number; day: number };
type ClockParts = { hour: number; minute: number };
export type ScheduleTimeField = keyof (CalendarParts & ClockParts);

/** Accept typed/pasted local times without converting them through UTC. */
export function parseScheduleTimeInput(input: string, withDate: boolean): string | null {
  const normalized = input.trim().replaceAll('/', '-').replace(/\s+/, 'T');
  const match = withDate
    ? /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/.exec(normalized)
    : /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  const [hour, minute] = numbers.slice(-2);
  if (hour > 23 || minute > 59) return null;
  const clock = `${pad(hour)}:${pad(minute)}`;
  if (!withDate) return clock;
  const [year, month, day] = numbers;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInScheduleMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}T${clock}`;
}

/** Keep wall-clock fields separate from Date so editing never shifts the selected timezone. */
export function scheduleTimeParts(value: string): ClockParts & { date: CalendarParts | null } {
  const [date, clock] = value.includes('T') ? value.split('T') : [null, value];
  const [hour, minute] = clock.split(':').map(Number);
  const [year, month, day] = date?.split('-').map(Number) ?? [];
  return { hour, minute, date: date ? { year, month, day } : null };
}

export function daysInScheduleMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function updateScheduleTime(value: string, field: ScheduleTimeField, next: number): string {
  const parts = scheduleTimeParts(value);
  const clock = { hour: parts.hour, minute: parts.minute, [field]: next };
  const time = `${pad(clock.hour)}:${pad(clock.minute)}`;
  if (!parts.date) return time;

  const date = { ...parts.date, [field]: next };
  // Changing month/year on the 29th–31st must stay in the selected month.
  const day = Math.min(date.day, daysInScheduleMonth(date.year, date.month));
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(day)}T${time}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
