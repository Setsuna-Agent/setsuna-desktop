export function formatDataBytes(bytes: number, locale: string): string {
  const normalized = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = normalized;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 100 || unit === 'B' ? 0 : 1,
  }).format(value)} ${unit}`;
}

export function formatDataDuration(seconds: number | undefined, locale: string): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format([
    `${minutes}m`,
    ...(remainingSeconds ? [`${remainingSeconds}s`] : []),
  ]);
}
