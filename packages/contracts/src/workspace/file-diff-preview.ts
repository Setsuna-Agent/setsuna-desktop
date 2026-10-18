/** Display budgets apply to new diffs and legacy projections, never to undo patches. */
export const FILE_DIFF_PREVIEW_LINES = 240;
export const FILE_DIFF_PREVIEW_CHARS = 24_000;
export const TURN_DIFF_PREVIEW_CHARS = 64_000;

export type FilePreviewProjectionMode = 'display' | 'storage';

export function limitFileDiffLines<T extends { content: string }>(
  lines: readonly T[],
  budget = { lines: FILE_DIFF_PREVIEW_LINES, chars: FILE_DIFF_PREVIEW_CHARS },
): { lines: T[]; truncated: boolean } {
  const result: T[] = [];
  let remaining = budget.chars;
  let truncated = false;
  for (const line of lines) {
    if (result.length >= budget.lines || remaining <= 0) break;
    const content = line.content.slice(0, remaining);
    result.push(content === line.content ? line : { ...line, content });
    remaining -= content.length + 1;
    truncated ||= content !== line.content;
  }
  return { lines: result, truncated: truncated || result.length < lines.length };
}

export function limitTurnDiff(diff: string): string {
  const marker = '\n[diff truncated]';
  return diff.length <= TURN_DIFF_PREVIEW_CHARS ? diff : diff.slice(0, TURN_DIFF_PREVIEW_CHARS - marker.length) + marker;
}

/** Storage keeps each file independently readable; display shares a patch-wide
 * budget and omits undo bodies. Other tool data retains its original contract. */
export function projectFileDiff(value: unknown, mode: FilePreviewProjectionMode = 'display'): unknown {
  return projectDiffWithBudget(value, mode, { lines: FILE_DIFF_PREVIEW_LINES, chars: FILE_DIFF_PREVIEW_CHARS });
}

function projectDiffWithBudget(value: unknown, mode: FilePreviewProjectionMode, budget: { lines: number; chars: number }): unknown {
  if (!isRecord(value)) return value;
  if (value.type === 'patch_diff' && Array.isArray(value.diffs)) {
    const source = value.diffs;
    const diffs = source.map((diff) => projectDiffWithBudget(diff, mode, budget));
    return diffs.every((diff, index) => diff === source[index]) ? value : {
      ...value, diffs, truncated: value.truncated || diffs.some((diff) => isRecord(diff) && diff.truncated),
    };
  }
  if (value.type !== 'file_diff' || !Array.isArray(value.lines)) return value;
  // Spending one file's storage allowance must never erase a later file's preview.
  if (mode === 'storage') budget = { lines: FILE_DIFF_PREVIEW_LINES, chars: FILE_DIFF_PREVIEW_CHARS };
  // Stop before walking the legacy array. One old DLL deletion can contain tens of thousands of lines.
  const candidates = value.lines.slice(0, budget.lines).filter(isDiffLine);
  const bounded = limitFileDiffLines(candidates, budget);
  budget.lines -= bounded.lines.length;
  budget.chars -= bounded.lines.reduce((count, line) => count + line.content.length + 1, 0);
  const truncated = bounded.truncated || candidates.length < value.lines.length;
  if (!truncated && (mode === 'storage' || value.undo === undefined)) return value;
  const result: Record<string, unknown> = { ...value, lines: bounded.lines, truncated: Boolean(value.truncated || truncated) };
  if (mode === 'display') delete result.undo;
  return result;
}

export function projectFileToolData(value: unknown, mode: FilePreviewProjectionMode = 'display'): unknown {
  if (!isRecord(value) || !isRecord(value.diff)) return value;
  const diff = projectFileDiff(value.diff, mode);
  return diff === value.diff ? value : { ...value, diff };
}

export function projectFileToolPreview(preview: string | undefined, data?: unknown, mode: FilePreviewProjectionMode = 'display'): string | undefined {
  if (!preview) return preview;
  // Completed local tools already carry the same structured diff. Avoid parsing a duplicate
  // multi-megabyte JSON string when opening old histories; its display copy has no undo body.
  if (isRecord(data) && isRecord(data.diff) && isLocalDiff(data.diff)) {
    return JSON.stringify({ diff: projectFileDiff(data.diff) });
  }
  if (!preview.startsWith('{')) return preview;
  try {
    const parsed: unknown = JSON.parse(preview);
    // Preview-only legacy records have no separate authoritative data. Preserve
    // their per-file previews and patches in storage, too.
    const projected = projectFileToolData(parsed, mode);
    return projected === parsed ? preview : JSON.stringify(projected);
  } catch {
    return preview;
  }
}

function isLocalDiff(value: Record<string, unknown>): boolean {
  return value.type === 'file_diff' || value.type === 'patch_diff';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDiffLine(value: unknown): value is Record<string, unknown> & { content: string } {
  return isRecord(value) && typeof value.content === 'string';
}
