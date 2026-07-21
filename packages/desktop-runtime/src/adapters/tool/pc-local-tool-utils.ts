// @ts-nocheck

/** Small shared value, result, and text helpers. */

import {
  MAX_TEXT_BYTES,
  MAX_TOOL_SUMMARY_CHARS,
} from './pc-local-tool-constants.js';

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countOccurrences(content, needle) {
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

export function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

export function integerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

export function shortSingleLine(value, maxChars = MAX_TOOL_SUMMARY_CHARS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export function relativeLabel(value) {
  return String(value || '').trim() || '.';
}

export function truncateText(value, maxChars = MAX_TEXT_BYTES) {
  const text = String(value ?? '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

export function clipString(value, maxChars) {
  const text = String(value ?? '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function truncateMiddle(value, maxChars = MAX_TEXT_BYTES) {
  const text = String(value ?? '');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars / 2);
  const tail = Math.max(0, maxChars - head - 40);
  return `${text.slice(0, head)}\n...[${text.length - head - tail} chars omitted]...\n${text.slice(text.length - tail)}`;
}

export function okResult(content, display, extra = {}) {
  return {
    ok: true,
    content,
    display,
    ...extra,
  };
}

export function errorResult(message, diagnostics = {}) {
  const failure = normalizeFailureDiagnostics(message, diagnostics);
  return {
    ok: false,
    content: `Error: ${message}`,
    display: message,
    ...diagnostics,
    ...failure,
  };
}

function normalizeFailureDiagnostics(message, diagnostics = {}) {
  const failureKind = String(diagnostics.failure_kind || classifyLocalToolFailure(message)).trim();
  const failureStage = String(diagnostics.failure_stage || defaultFailureStage(failureKind)).trim();
  return {
    ...(failureKind ? { failure_kind: failureKind } : {}),
    ...(failureStage ? { failure_stage: failureStage } : {}),
  };
}

function defaultFailureStage(failureKind) {
  if (failureKind === 'timeout' || failureKind === 'process_exit' || failureKind === 'stdin_closed') return 'execution';
  if (failureKind === 'policy_blocked' || failureKind === 'permission_denied' || failureKind === 'sandbox_unavailable' || failureKind === 'network_denied') return 'preflight';
  return 'validation';
}

function classifyLocalToolFailure(message) {
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
