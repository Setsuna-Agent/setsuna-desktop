import type { WorkspaceFileChangeAction, WorkspaceFileChangePatch } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';

export function fileContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Keep raw text, including line endings and EOF, independently of the folded display diff. */
export function createFileChangePatch(before: string | null, after: string | null): WorkspaceFileChangePatch {
  const previous = before ?? '';
  const next = after ?? '';
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return {
    beforeHash: before === null ? null : fileContentHash(before),
    afterHash: after === null ? null : fileContentHash(after),
    start,
    deleteCount: nextEnd - start,
    insert: previous.slice(start, previousEnd),
    removed: next.slice(start, nextEnd),
  };
}

export function isFileChangePatch(value: unknown): value is WorkspaceFileChangePatch {
  if (!value || typeof value !== 'object') return false;
  const patch = value as Record<string, unknown>;
  return isHash(patch.beforeHash) && isHash(patch.afterHash)
    && Number.isSafeInteger(patch.start) && Number(patch.start) >= 0
    && Number.isSafeInteger(patch.deleteCount) && Number(patch.deleteCount) >= 0
    && typeof patch.insert === 'string'
    && [patch.beforeMode, patch.afterMode].every((mode) => mode === undefined
      || (Number.isInteger(mode) && Number(mode) >= 0 && Number(mode) <= 0o777))
    // Older deletion records captured neither raw-byte validation nor permissions.
    && (patch.afterHash !== null || patch.beforeHash === null || patch.beforeMode !== undefined);
}

export function applyFileChangePatch(
  current: string | null,
  patch: WorkspaceFileChangePatch,
  action: WorkspaceFileChangeAction,
): string | null {
  if (!isFileChangePatch(patch)) throw new Error('No complete file change record.');
  const undo = action === 'undo';
  const expectedHash = undo ? patch.afterHash : patch.beforeHash;
  const resultHash = undo ? patch.beforeHash : patch.afterHash;
  if ((current === null ? null : fileContentHash(current)) !== expectedHash) {
    throw new Error('File changed after this operation.');
  }
  if (!undo && (typeof patch.removed !== 'string' || patch.removed.length !== patch.deleteCount)) {
    throw new Error('No complete reapply record.');
  }
  const source = current ?? '';
  const deleteCount = undo ? patch.deleteCount : patch.insert.length;
  const insert = undo ? patch.insert : patch.removed!;
  if (patch.start + deleteCount > source.length) throw new Error('Invalid change range.');
  const restored = source.slice(0, patch.start) + insert + source.slice(patch.start + deleteCount);
  if (resultHash === null) {
    if (restored !== '') throw new Error('Invalid file deletion record.');
    return null;
  }
  if (fileContentHash(restored) !== resultHash) throw new Error('Incomplete change record.');
  return restored;
}

function isHash(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value));
}
