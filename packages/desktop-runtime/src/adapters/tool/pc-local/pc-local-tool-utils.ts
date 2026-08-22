/** Small shared value, result, and text helpers. */

import {
  MAX_TEXT_BYTES,
  MAX_TOOL_SUMMARY_CHARS,
} from './pc-local-tool-constants.js';

export type LocalToolSuccess<TExtra extends object = Record<string, never>> = {
  ok: true;
  content: string;
  display: string;
} & TExtra;

export type LocalToolFailure<TDiagnostics extends object = Record<string, never>> = {
  ok: false;
  content: string;
  display: string;
  failure_kind: string;
  failure_stage: string;
} & TDiagnostics;

export function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

export function integerOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

export function shortSingleLine(value: unknown, maxChars = MAX_TOOL_SUMMARY_CHARS): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export function truncateText(value: unknown, maxChars = MAX_TEXT_BYTES): string {
  const text = String(value ?? '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

export function clipString(value: unknown, maxChars: number): string {
  const text = String(value ?? '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function truncateMiddle(value: unknown, maxChars = MAX_TEXT_BYTES): string {
  const text = String(value ?? '');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars / 2);
  const tail = Math.max(0, maxChars - head - 40);
  return `${text.slice(0, head)}\n...[${text.length - head - tail} chars omitted]...\n${text.slice(text.length - tail)}`;
}

export function okResult<TExtra extends object = Record<string, never>>(
  content: string,
  display: string,
  extra: TExtra = {} as TExtra,
): LocalToolSuccess<TExtra> {
  return {
    ok: true,
    content,
    display,
    ...extra,
  } as LocalToolSuccess<TExtra>;
}

export function errorResult<TDiagnostics extends Record<string, unknown> = Record<string, never>>(
  message: string,
  diagnostics: TDiagnostics = {} as TDiagnostics,
): LocalToolFailure<TDiagnostics> {
  const failure = normalizeFailureDiagnostics(message, diagnostics);
  return {
    ok: false,
    content: `Error: ${message}`,
    display: message,
    ...diagnostics,
    ...failure,
  } as LocalToolFailure<TDiagnostics>;
}

function normalizeFailureDiagnostics(
  message: string,
  diagnostics: Readonly<Record<string, unknown>>,
): { failure_kind: string; failure_stage: string } {
  const failureKind = String(diagnostics.failure_kind || classifyLocalToolFailure(message)).trim();
  const failureStage = String(diagnostics.failure_stage || defaultFailureStage(failureKind)).trim();
  return { failure_kind: failureKind, failure_stage: failureStage };
}

function defaultFailureStage(failureKind: string): string {
  if (failureKind === 'timeout' || failureKind === 'process_exit' || failureKind === 'stdin_closed') return 'execution';
  if (failureKind === 'policy_blocked' || failureKind === 'permission_denied' || failureKind === 'sandbox_unavailable' || failureKind === 'network_denied') return 'preflight';
  return 'validation';
}

function classifyLocalToolFailure(message: string): string {
  const text = String(message || '');
  if (/not found or already closed/i.test(text)) return 'process_not_found';
  if (/process id is required/i.test(text) || /cannot be empty/i.test(text)) return 'invalid_arguments';
  if (/路径不在当前工作区内/.test(text)) return 'path_outside_workspace';
  if (/read-only/.test(text)) return 'permission_denied';
  if (/sandbox/i.test(text) || /OS sandbox/.test(text)) return 'sandbox_unavailable';
  if (/找不到文件|ENOENT|no such file/i.test(text)) return 'file_not_found';
  if (/not a .*file|不是.*文件/i.test(text)) return 'not_a_file';
  if (/not a directory|不是.*目录/i.test(text)) return 'not_a_directory';
  return 'runtime_error';
}
