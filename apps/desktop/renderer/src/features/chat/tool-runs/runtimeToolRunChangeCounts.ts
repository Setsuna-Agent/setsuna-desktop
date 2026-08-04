import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import {
  fileChangeFromToolRun,
  fileChangesFromToolRun,
} from './runtimeFileChanges.js';
import {
  countTextLines,
  isRecord,
  optionalNumber,
  recordFromJson,
  stringField,
} from './runtimeToolRunPresentationUtils.js';

export function fileMutationChangeTotals(
  run: RuntimeToolRun,
): { additions: number; deletions: number } | null {
  const changes = fileChangesFromToolRun(run);
  if (changes.length) {
    return {
      additions: changes.reduce((total, file) => total + file.additions, 0),
      deletions: changes.reduce((total, file) => total + file.deletions, 0),
    };
  }
  const change = fileChangeFromToolRun(run);
  return change
    ? { additions: change.additions, deletions: change.deletions }
    : null;
}

export function fileOperationChangeTotals(
  run: RuntimeToolRun,
): { additions: number; deletions: number; showZero: boolean } | null {
  const showZero = run.status === 'success';
  const resultTotals = fileMutationChangeTotals(run);
  if (resultTotals) return { ...resultTotals, showZero };
  const argumentTotals = fileOperationChangeTotalsFromArguments(run);
  if (argumentTotals) return { ...argumentTotals, showZero };
  return null;
}

export function fileOperationChangeTotalsFromArguments(
  run: RuntimeToolRun,
): { additions: number; deletions: number } | null {
  const args = recordFromJson(run.argumentsPreview);
  const directAdditions = optionalNumber(args.additions);
  const directDeletions = optionalNumber(args.deletions);
  if (directAdditions !== null || directDeletions !== null) {
    return {
      additions: directAdditions ?? 0,
      deletions: directDeletions ?? 0,
    };
  }

  const diffTotals = fileOperationDiffTotalsFromValue(
    args.diff ?? args.diffs ?? args.files ?? args.changes,
  );
  if (diffTotals) return diffTotals;

  if (run.name === 'delete_file') return { additions: 0, deletions: 0 };
  if (run.name === 'append_file') {
    const content = stringField(args.content ?? args.text);
    if (content) {
      return { additions: countTextLines(content), deletions: 0 };
    }
  }
  if (run.name === 'write_file') {
    const content = stringField(args.content);
    if (content && !content.includes('...[truncated ')) {
      return { additions: countTextLines(content), deletions: 0 };
    }
  }
  return null;
}

export function fileOperationDiffTotalsFromValue(
  value: unknown,
): { additions: number; deletions: number } | null {
  const items = Array.isArray(value) ? value : [value];
  let hasDiff = false;
  let additions = 0;
  let deletions = 0;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const nested = fileOperationDiffTotalsFromValue(
      item.diff ?? item.diffs ?? item.files ?? item.changes,
    );
    if (nested) {
      hasDiff = true;
      additions += nested.additions;
      deletions += nested.deletions;
      continue;
    }
    const itemAdditions = optionalNumber(item.additions);
    const itemDeletions = optionalNumber(item.deletions);
    if (itemAdditions !== null || itemDeletions !== null) {
      hasDiff = true;
      additions += itemAdditions ?? 0;
      deletions += itemDeletions ?? 0;
    }
  }
  return hasDiff ? { additions, deletions } : null;
}
