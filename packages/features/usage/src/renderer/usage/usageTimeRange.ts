import type { RuntimeUsageQuery } from '../../contracts/index.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type UsageTimePreset = 'all' | 'today' | '24h' | '7d' | '30d';
export type UsageTimeRangeId = UsageTimePreset | 'custom';

export type UsageCustomTimeRange = {
  from: string;
  to: string;
};

/** 自定义时段校验失败的原因；用于给出比“边框标红”更明确的提示。 */
export type UsageCustomRangeIssue = 'invalid-from' | 'invalid-to' | 'end-before-start';

/**
 * 校验自定义时段并返回具体原因。`usageQueryForCustomRange` 只回答“能不能查”，
 * 这里补上“为什么不能”，供 UI 展示可读提示。
 */
export function inspectUsageCustomRange(range: UsageCustomTimeRange): UsageCustomRangeIssue | null {
  const from = parseLocalDateTime(range.from);
  if (!from) return 'invalid-from';
  const to = parseLocalDateTime(range.to);
  if (!to) return 'invalid-to';
  if (from > to) return 'end-before-start';
  return null;
}

export function usageQueryForPreset(
  preset: Exclude<UsageTimePreset, 'all'>,
  now: Date = new Date(),
): RuntimeUsageQuery {
  const end = validDate(now) ?? new Date();
  const start = new Date(end);
  if (preset === 'today') {
    start.setHours(0, 0, 0, 0);
  } else {
    const days = preset === '24h' ? 1 : preset === '7d' ? 7 : 30;
    start.setTime(end.getTime() - days * DAY_MS);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * 自定义输入按用户设备的本地时间解析；滚轮只精确到分，所以结束分钟按整分钟包含，
 * 上界加满一分钟再取 ISO 字符串。
 */
export function usageQueryForCustomRange(
  range: UsageCustomTimeRange,
): RuntimeUsageQuery | null {
  if (inspectUsageCustomRange(range)) return null;
  const from = parseLocalDateTime(range.from);
  const selectedTo = parseLocalDateTime(range.to);
  if (!from || !selectedTo) return null;
  return {
    from: from.toISOString(),
    to: new Date(selectedTo.getTime() + MINUTE_MS).toISOString(),
  };
}

export function defaultUsageCustomTimeRange(now: Date = new Date()): UsageCustomTimeRange {
  const end = validDate(now) ?? new Date();
  return {
    from: formatUsageCustomTimeValue(new Date(end.getTime() - DAY_MS)),
    to: formatUsageCustomTimeValue(end),
  };
}

function parseLocalDateTime(value: string): Date | null {
  const parts = parseUsageCustomTimeValue(value);
  if (!parts) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return date.getFullYear() === parts.year
    && date.getMonth() === parts.month - 1
    && date.getDate() === parts.day
    && date.getHours() === parts.hour
    && date.getMinutes() === parts.minute
    ? date
    : null;
}

export type UsageCustomTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Merge one wheel's change into the latest value and keep the resulting local date editable. */
export function updateUsageCustomTimeValue(value: string, patch: Partial<UsageCustomTimeParts>): string {
  const parts = parseUsageCustomTimeValue(value);
  if (!parts) return value;
  const next = { ...parts, ...patch };
  const day = Math.min(next.day, new Date(next.year, next.month, 0).getDate());
  // Clamp month ends before constructing Date; Date also advances across a local DST gap.
  return formatUsageCustomTimeValue(new Date(next.year, next.month - 1, day, next.hour, next.minute));
}

/** 解析 `YYYY/MM/DD HH:mm`；越界日期（例如 2 月 30 日）返回 null。 */
export function parseUsageCustomTimeValue(value: string): UsageCustomTimeParts | null {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
    ? { year, month, day, hour, minute }
    : null;
}

export function formatUsageCustomTimeValue(value: Date | UsageCustomTimeParts): string {
  const parts = value instanceof Date
    ? {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
    }
    : value;
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('/') + ` ${[parts.hour, parts.minute].map((part) => String(part).padStart(2, '0')).join(':')}`;
}

function validDate(value: Date): Date | null {
  return Number.isNaN(value.getTime()) ? null : value;
}
