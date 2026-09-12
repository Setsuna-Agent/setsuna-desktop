import { WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES, type WorkspaceFileChange, type WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeUseCaseError } from '../../runtime/use-cases/errors.js';
import { applyFileChangePatch } from '../../utils/file-change-patch.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { invalidateFileMentionIndex } from '../tool/file-mentions.js';
import { commitFileChanges, type LocalFileChange } from '../tool/pc-local/pc-local-tool-file-transaction.js';
import { realWorkspaceRoot, resolveWorkspaceDeletionPath } from '../tool/pc-local/pc-local-tool-paths.js';

type ChangeSource = { content: string; mode?: number } | null;

/** Validate the whole card before committing once, including repeated edits to the same file. */
export async function applyWorkspaceFileChanges(
  workspaceRoot: string,
  changes: WorkspaceFileChange[],
  action: WorkspaceFileChangeAction,
): Promise<void> {
  const root = realWorkspaceRoot(workspaceRoot);
  await withFileStateUpdate(root, async () => {
    const files = new Map<string, { original: ChangeSource; restored: ChangeSource }>();
    // Undo walks back through the operations; reapply restores their original order.
    for (const change of action === 'undo' ? [...changes].reverse() : changes) {
      const filePath = resolveChangePath(root, change.path);
      let file = files.get(filePath);
      if (!file) {
        const original = await readChangeSource(filePath);
        file = { original, restored: original };
        files.set(filePath, file);
      }
      try {
        const expectedMode = action === 'undo' ? change.patch.afterMode : change.patch.beforeMode;
        const restoredMode = action === 'undo' ? change.patch.beforeMode : change.patch.afterMode;
        if (expectedMode !== undefined && file.restored?.mode !== undefined && file.restored.mode !== expectedMode) {
          throw new Error('File permissions changed after this operation.');
        }
        const content = applyFileChangePatch(file.restored?.content ?? null, change.patch, action);
        file.restored = content === null ? null : { content, mode: restoredMode ?? file.restored?.mode };
      } catch {
        throw new RuntimeUseCaseError('conflict', `Cannot ${action === 'undo' ? 'undo' : 'reapply'} ${change.path}: the file changed or its change record is incomplete. No files were changed.`);
      }
    }
    const mutations: LocalFileChange[] = [];
    for (const [filePath, file] of files) {
      if (file.original?.content === file.restored?.content && file.original?.mode === file.restored?.mode) continue;
      mutations.push({
        action: file.restored === null ? 'delete' : 'write',
        filePath,
        existed: file.original !== null,
        previousContent: file.original?.content ?? '',
        nextContent: file.restored?.content ?? '',
        previousMode: file.original?.mode,
        nextMode: file.restored?.mode,
      });
    }
    // The existing transaction rechecks file contents and identities after staging,
    // then rolls back the entire set if a write fails or another process races it.
    await commitFileChanges(mutations, { root });
    invalidateFileMentionIndex(root);
  });
}

function resolveChangePath(root: string, value: string): string {
  if (!value || value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new RuntimeUseCaseError('invalid_input', 'File change paths must be relative to the workspace.');
  }
  const target = resolveWorkspaceDeletionPath(value.replace(/\\/gu, '/'), root);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new RuntimeUseCaseError('invalid_input', 'File change path escapes the workspace.');
  }
  return target;
}

async function readChangeSource(filePath: string): Promise<ChangeSource> {
  const info = await lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.size > WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) {
    throw new RuntimeUseCaseError('invalid_request', 'Only regular text files within the editor size limit can be restored.');
  }
  const bytes = await readFile(filePath);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) {
    throw new RuntimeUseCaseError('invalid_request', 'Only UTF-8 text file changes can be restored.');
  }
  return { content, mode: info.mode & 0o777 };
}
