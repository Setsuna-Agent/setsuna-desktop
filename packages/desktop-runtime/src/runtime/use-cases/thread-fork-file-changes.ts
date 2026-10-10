import path from 'node:path';
import { isFileChangePatch } from '../../utils/file-change-patch.js';

export type ForkFileChangeRelocation = {
  sourceRoot: string;
  destinationRoot: string;
  sharedRoots: string[];
};

/** A worktree snapshot owns primary-repository changes; other bound directories stay shared. */
export function relocateForkFileChanges(data: unknown, relocation: ForkFileChangeRelocation): unknown {
  const result = record(data);
  const diff = record(result?.diff);
  if (!result || !diff) return data;
  const relocate = (value: unknown): unknown => {
    const file = record(value);
    if (!file || typeof file.path !== 'string' || !isFileChangePatch(file.undo)) return value;
    // Legacy records are relative to the workspace copied at this fork boundary.
    const target = typeof file.absolutePath === 'string' ? file.absolutePath : path.resolve(relocation.sourceRoot, file.path);
    // A more specific nested binding stays shared; an ancestor binding does not override the primary root.
    const shared = relocation.sharedRoots.some((root) => within(relocation.sourceRoot, root) && within(root, target));
    const copied = within(relocation.sourceRoot, target) && !shared;
    return { ...file, absolutePath: copied
      ? path.resolve(relocation.destinationRoot, path.relative(relocation.sourceRoot, target))
      : target,
    };
  };
  return { ...result, diff: Array.isArray(diff.diffs)
    ? { ...diff, diffs: diff.diffs.map(relocate) }
    : relocate(diff),
  };
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
