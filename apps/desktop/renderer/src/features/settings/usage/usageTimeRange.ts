import type { RuntimeUsageQuery } from '@setsuna-desktop/contracts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type UsageTimePreset = 'all' | 'today' | '24h' | '7d' | '30d';
export type UsageTimeRangeId = UsageTimePreset | 'custom';

export type UsageCustomTimeRange = {
  from: string;
  to: string;
};

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
 * 自定义输入按用户设备的本地时间解析，并把结束分钟转换成 exclusive 上界，
 * 确保用户选择的整分钟都被包含，同时不向界面暴露秒。
 */
export function usageQueryForCustomRange(
  range: UsageCustomTimeRange,
): RuntimeUsageQuery | null {
  const from = parseLocalDateTime(range.from);
  const selectedTo = parseLocalDateTime(range.to);
  if (!from || !selectedTo || from > selectedTo) return null;
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
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0, 0);
  return date.getFullYear() === parts[0]
    && date.getMonth() === parts[1] - 1
    && date.getDate() === parts[2]
    && date.getHours() === parts[3]
    && date.getMinutes() === parts[4]
    ? date
    : null;
}

export function formatUsageCustomTimeValue(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

function validDate(value: Date): Date | null {
  return Number.isNaN(value.getTime()) ? null : value;
}
