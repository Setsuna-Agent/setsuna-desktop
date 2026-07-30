import type { RuntimeToolRun } from '@setsuna-desktop/contracts';

export function recordFromJson(
  value: string | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

export function countTextLines(value: string): number {
  if (!value) return 0;
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

export function formatPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
  }
}

export function compactUrlTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const path = `${url.pathname}${url.search}`.replace(/\/$/u, '') || '/';
    return `${url.hostname}${path}`;
  } catch {
    return trimmed.replace(/^https?:\/\//iu, '').replace(/\/$/u, '');
  }
}

export function toolRunTarget(run: RuntimeToolRun): string {
  const args = recordFromJson(run.argumentsPreview);
  const url = stringField(args.url ?? args.uri ?? args.href);
  if (url) return compactUrlTarget(url);
  return stringField(
    args.command
      ?? args.cmd
      ?? args.query
      ?? args.path
      ?? args.file_path
      ?? args.target_path
      ?? args.file
      ?? args.process_id
      ?? args.processId,
  );
}

export function isWebContentRun(
  run: RuntimeToolRun,
  url = stringField(recordFromJson(run.argumentsPreview).url),
): boolean {
  if (!url) return false;
  return /(^|\s|_|-)fetch(web)?content($|\s|_|-)/iu.test(run.name)
    || /^https?:\/\//iu.test(url);
}

export function genericToolRunDiagnostic(run: RuntimeToolRun): string {
  if (
    run.status !== 'error'
    && run.status !== 'rejected'
    && run.status !== 'cancelled'
  ) {
    return '';
  }
  return concisePreview(
    run.approvalMessage || run.resultPreview || run.approvalReason || '',
  );
}

export function isPreparingToolRun(run: RuntimeToolRun): boolean {
  return run.status === 'running' && run.phase === 'preparing';
}

export function concisePreview(value: string): string {
  const normalized = formatPreview(value).replace(/\s+/gu, ' ').trim();
  return normalized.length > 600 ? `${normalized.slice(0, 600)}...` : normalized;
}
