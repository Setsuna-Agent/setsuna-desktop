import path from 'node:path';
import { WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { designDocumentCodec } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { isNodeError } from '../../shared/node-errors.js';
import { isPathWithin } from '../search/workspace-search-policy.js';
import { withFileStateUpdates } from '../store/file-state-coordinator.js';
import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { readWorkspaceFilePreview } from './workspace-file-preview-reader.js';

export type DesignFile = Awaited<ReturnType<typeof resolveDesignFile>>;

export async function withDesignSource<T>(root: string, relativePath: string, boundRoots: readonly string[], destination: string | undefined,
  signal: AbortSignal, operation: (source: DesignFile, roots: readonly string[]) => Promise<T>,
  options?: Readonly<{ lockNestedRoots: boolean }>,
) {
  signal.throwIfAborted();
  const original = await resolveDesignFile(root, relativePath);
  const roots = [...new Set([root, ...boundRoots.filter((candidate) => isPathWithin(candidate, original.target))])];
  const destinationRoots = destination ? [destination, ...boundRoots.filter((candidate) => isPathWithin(candidate, destination))] : [];
  const transactionRoots = [...roots, ...destinationRoots];
  // Transfer checks also read existing files reachable through a bound root under the destination.
  const nestedRoots = options?.lockNestedRoots
    ? boundRoots.filter((candidate) => roots.some((scope) => isPathWithin(scope, candidate))
      || (destination && isPathWithin(destination, candidate))) : [];
  // The same draft and its resource binding are reachable through every enclosing root.
  return withFileStateUpdates([...transactionRoots, ...nestedRoots], async () => {
    signal.throwIfAborted();
    const source = await resolveDesignFile(root, relativePath);
    if (path.relative(original.target, source.target)) throw designChanged();
    return operation(source, roots);
  });
}

export async function resolveDesignFile(root: string, relativePath: string) {
  try {
    const entry = await resolveExistingWorkspaceEntry(root, relativePath);
    if (!entry.stats.isFile()) throw new Error('A design document must be a regular file.');
    return entry;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    throw new FeatureOperationFailure({ code: 'DESIGN_NOT_FOUND', message: 'The design file was not found.', retryable: false });
  }
}

export async function readDesignFile(target: string, relativePath: string) {
  const file = await readWorkspaceFilePreview(target, relativePath, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES);
  if (file.preview?.kind !== 'text' || file.truncated || !file.revision) {
    throw new FeatureOperationFailure({
      code: 'INVALID_DESIGN_DOCUMENT', message: 'The design file could not be read as a workspace text file.', retryable: false,
    });
  }
  return { content: file.content, revision: file.revision };
}

export async function readDesignDocumentFile(target: string, relativePath: string) {
  const file = await readDesignFile(target, relativePath);
  try {
    return { ...file, document: designDocumentCodec.parse(JSON.parse(file.content)) };
  } catch {
    throw new FeatureOperationFailure({ code: 'INVALID_DESIGN_DOCUMENT', message: `Invalid design file "${relativePath}".`, retryable: false });
  }
}

export function readValidDesignDocument(target: string, relativePath: string) {
  return readDesignDocumentFile(target, relativePath).catch((error: unknown) => {
    if (error instanceof FeatureOperationFailure && error.code === 'INVALID_DESIGN_DOCUMENT') return undefined;
    throw error;
  });
}

export function designChanged() {
  return new FeatureOperationFailure({ code: 'REVISION_CONFLICT', message: 'The design changed on disk.', retryable: true });
}
