import type { RuntimeToolRun } from '../threads.js';

/** Structured results win over the legacy duplicate JSON preview. */
export function fileDiffRecordsFromRun(run: RuntimeToolRun): Record<string, unknown>[] {
  let source = diffRecord(run.data);
  if (!source || (!source.path && !Array.isArray(source.diffs))) {
    try { source = diffRecord(JSON.parse(run.resultPreview ?? 'null')); } catch { source = null; }
  }
  return (Array.isArray(source?.diffs) ? source.diffs : [source]).flatMap((value) => {
    const file = record(value);
    return file && typeof file.path === 'string' && file.path ? [file] : [];
  });
}

/** Whitelist metadata so neither summary nor preview responses can leak undo bodies. */
export function fileChangeMetadata(file: Record<string, unknown>) {
  return {
    type: 'file_diff', path: file.path as string,
    ...(typeof file.absolutePath === 'string' ? { absolutePath: file.absolutePath } : {}),
    ...(typeof file.action === 'string' ? { action: file.action } : {}),
    additions: count(file.additions), deletions: count(file.deletions),
    truncated: Boolean(file.truncated), lines: [] as unknown[],
  };
}

function diffRecord(value: unknown) {
  const source = record(value);
  return record(source?.diff) ?? source;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function count(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
