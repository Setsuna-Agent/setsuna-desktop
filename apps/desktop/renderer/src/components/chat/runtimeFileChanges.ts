import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { buildChatTranscript } from './chatMessageDisplay.js';

export type RuntimeFileDiffLine = {
  type: 'added' | 'removed' | 'context' | 'gap';
  lineNumber?: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type RuntimeFileChange = {
  path: string;
  action?: string | null;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: RuntimeFileDiffLine[];
};

export type RuntimeFileChangeSummary = {
  files: RuntimeFileChange[];
  additions: number;
  deletions: number;
};

type FileMutationEntry = {
  key: string;
  run: RuntimeToolRun;
};

const fileMutationToolNames = new Set([
  'workspace_write_file',
  'plan_file_changes',
  'begin_file_change',
  'apply_patch',
  'write_file',
  'append_file',
  'delete_file',
  'edit',
  'edit_file',
]);

export function collapseFileMutationRunsInSegments(segments: RuntimeMessage[]): RuntimeMessage[] {
  const entriesByPath = new Map<string, FileMutationEntry[]>();

  for (const segment of segments) {
    for (const run of segment.toolRuns ?? []) {
      if (!isRuntimeFileMutationRun(run)) continue;
      const key = fileMutationDisplayKey(run);
      if (!key) continue;
      const entries = entriesByPath.get(key) ?? [];
      entries.push({ key, run });
      entriesByPath.set(key, entries);
    }
  }

  const hiddenIds = new Set<string>();
  const previewByPrimaryId = new Map<string, string>();

  for (const entries of entriesByPath.values()) {
    if (!entries.length) continue;
    const primary = [...entries].reverse().find((entry) => entry.run.status === 'success') ?? entries[entries.length - 1];
    const summary = fileChangeSummaryFromRuns(entries.map((entry) => entry.run));
    if (primary.run.status === 'success') {
      for (const entry of entries) {
        if (entry.run.id !== primary.run.id && entry.run.status === 'success') hiddenIds.add(entry.run.id);
      }
      if (summary?.files.length) previewByPrimaryId.set(primary.run.id, serializeFileChangePreview(summary.files));
    }
  }

  if (!hiddenIds.size && !previewByPrimaryId.size) return segments;

  return segments.map((segment) => {
    if (!segment.toolRuns?.length) return segment;
    const toolRuns = segment.toolRuns
      .filter((run) => !hiddenIds.has(run.id))
      .map((run) => {
        const resultPreview = previewByPrimaryId.get(run.id);
        return resultPreview ? { ...run, resultPreview } : run;
      });
    return toolRuns === segment.toolRuns ? segment : { ...segment, toolRuns };
  });
}

export function isRuntimeFileMutationRun(run: RuntimeToolRun): boolean {
  return fileMutationToolNames.has(run.name);
}

export function fileMutationDisplayPath(run: RuntimeToolRun): string {
  const changes = fileChangesFromToolRun(run);
  if (changes.length === 1 && changes[0]?.path) return changes[0].path;
  const args = recordFromJson(run.argumentsPreview);
  return (
    stringField(args.path ?? args.file_path ?? args.target_path ?? args.file) ||
    (changes.length > 1 ? `${changes.length} 个文件` : '') ||
    fileMutationPathFromResult(run.resultPreview)
  );
}

export function fileMutationDisplayKey(run: RuntimeToolRun): string {
  return normalizePathKey(fileMutationDisplayPath(run));
}

export function fileChangesFromToolRun(run: RuntimeToolRun): RuntimeFileChange[] {
  if (!run.resultPreview || run.status === 'error' || run.status === 'rejected') return [];
  const parsed = parseJson(run.resultPreview);
  if (!parsed) return [];
  return extractFileChanges(parsed);
}

export function fileChangeFromToolRun(run: RuntimeToolRun): RuntimeFileChange | null {
  return fileChangesFromToolRun(run)[0] ?? null;
}

export function fileChangeSummaryFromRuns(runs: RuntimeToolRun[]): RuntimeFileChangeSummary | null {
  const byPath = new Map<string, RuntimeFileChange>();

  for (const run of runs) {
    if (!isRuntimeFileMutationRun(run) || run.status !== 'success') continue;
    for (const file of fileChangesFromToolRun(run)) {
      if (!file.path) continue;
      const current = byPath.get(file.path);
      byPath.set(file.path, current ? mergeFileChange(current, file) : normalizeFileChange(file));
    }
  }

  const files = [...byPath.values()];
  if (!files.length) return null;
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function latestFileChangeSummaryFromMessages(messages: RuntimeMessage[]): RuntimeFileChangeSummary | null {
  const transcript = buildChatTranscript(messages);
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item.type !== 'assistant') continue;
    const displaySegments = collapseFileMutationRunsInSegments(item.segments);
    const summary = fileChangeSummaryFromRuns(displaySegments.flatMap((segment) => segment.toolRuns ?? []));
    if (summary?.files.length) return summary;
  }

  return null;
}

function serializeFileChangePreview(files: RuntimeFileChange[]): string {
  return JSON.stringify({
    diff: files.length === 1 ? files[0] : { diffs: files },
  });
}

function extractFileChanges(value: unknown): RuntimeFileChange[] {
  const diff = asDiffRecord(value);
  if (!diff) return [];
  const diffs = Array.isArray(diff.diffs) ? diff.diffs : [diff];
  return diffs.map(extractFileChange).filter((item): item is RuntimeFileChange => Boolean(item));
}

function extractFileChange(value: unknown): RuntimeFileChange | null {
  if (!isRecord(value)) return null;
  const path = stringField(value.path);
  if (!path) return null;
  return normalizeFileChange({
    path,
    action: typeof value.action === 'string' ? value.action : null,
    additions: count(value.additions),
    deletions: count(value.deletions),
    truncated: Boolean(value.truncated),
    lines: Array.isArray(value.lines) ? value.lines.map(normalizeDiffLine).filter(isRuntimeFileDiffLine) : [],
  });
}

function normalizeFileChange(file: RuntimeFileChange): RuntimeFileChange {
  return {
    ...file,
    additions: count(file.additions),
    deletions: count(file.deletions),
    truncated: Boolean(file.truncated),
    lines: Array.isArray(file.lines) ? file.lines.map(normalizeDiffLine).filter(isRuntimeFileDiffLine) : [],
  };
}

function normalizeDiffLine(value: unknown): RuntimeFileDiffLine | null {
  if (!isRecord(value)) return null;
  const type = value.type === 'added' || value.type === 'removed' || value.type === 'context' || value.type === 'gap' ? value.type : 'context';
  return {
    type,
    lineNumber: optionalCount(value.lineNumber),
    oldLine: optionalCount(value.oldLine),
    newLine: optionalCount(value.newLine),
    content: typeof value.content === 'string' ? value.content : '',
  };
}

function isRuntimeFileDiffLine(value: RuntimeFileDiffLine | null): value is RuntimeFileDiffLine {
  return Boolean(value);
}

function mergeFileChange(previous: RuntimeFileChange, next: RuntimeFileChange): RuntimeFileChange {
  const previousLines = previous.lines ?? [];
  const nextLines = next.lines ?? [];
  const separator: RuntimeFileDiffLine[] = previousLines.length && nextLines.length ? [{ type: 'gap', content: '...' }] : [];
  return {
    ...next,
    action: normalizeAction(previous.action) === 'created' ? previous.action : next.action,
    additions: previous.additions + next.additions,
    deletions: previous.deletions + next.deletions,
    truncated: previous.truncated || next.truncated,
    lines: [...previousLines, ...separator, ...nextLines].slice(0, 240),
  };
}

function asDiffRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value.diff) ? value.diff : value;
}

function fileMutationPathFromResult(value: string | undefined): string {
  return /^(?:Created|Updated)\s+(.+?)\s+\(/imu.exec(value ?? '')?.[1]?.trim() ?? '';
}

function normalizePathKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

function normalizeAction(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function recordFromJson(value: string | undefined): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : {};
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function optionalCount(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined;
}
