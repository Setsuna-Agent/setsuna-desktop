import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { isValidWorkspaceEntryName, workspaceTarget, WORKSPACE_ENTRY_EXISTS_ERROR_CODE, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { isDesignDocumentPath, type DesignWorkspaceFiles } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { isNodeError } from '../../shared/node-errors.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { writeTextFile } from '../store/json-file.js';
import { safeStorageFileStem } from '../store/storage-file-name.js';
import { walkWorkspaceFiles, type FileWorkspaceProjectStore } from './file-workspace-project-store.js';
import { createWorkspaceEntry, resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { readWorkspaceFilePreview } from './workspace-file-preview-reader.js';

const designAssetDirectory = 'design-assets';

export function createDesignWorkspaceFiles(
  projects: Pick<FileWorkspaceProjectStore, 'resolveWorkspaceRoot'>,
): DesignWorkspaceFiles {
  return {
    async list({ projectId, rootId }, signal) {
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(projectId, rootId));
      const paths: string[] = [];
      await walkWorkspaceFiles(root, (file) => {
        if (isDesignDocumentPath(file)) paths.push(path.relative(root, file).split(path.sep).join('/'));
        return true;
      }, signal);
      signal.throwIfAborted();
      return paths.sort((a, b) => a.localeCompare(b));
    },
    async create(input, content, signal) {
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(input.projectId, input.rootId));
      try {
        return await createWorkspaceEntry(root, { parentPath: input.parentPath, name: input.name, type: 'file' }, { content, signal });
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
        throw new FeatureOperationFailure({
          code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE, message: 'A file or folder with that name already exists.', retryable: false,
        });
      }
    },
    async importImage(ref, { name, extension, bytes }, signal) {
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId));
      await resolveDesignFile(root, ref.path);
      try {
        await createWorkspaceEntry(root, { parentPath: '.', name: designAssetDirectory, type: 'directory' }, { signal });
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      }
      const directory = await resolveExistingWorkspaceEntry(root, designAssetDirectory);
      if (!directory.stats.isDirectory()) throw new Error('The design assets location must be a directory.');

      const stem = safeStorageFileStem(path.parse(name).name.replace(/^\.+/u, ''), 'image');
      const safeStem = isValidWorkspaceEntryName(`${stem}.${extension}`) ? stem : `_${stem}`;
      for (let ordinal = 1; ; ordinal += 1) {
        const filename = ordinal === 1 ? `${safeStem}.${extension}` : `${safeStem}-${ordinal}.${extension}`;
        try {
          const entry = await createWorkspaceEntry(root, {
            parentPath: designAssetDirectory, name: filename, type: 'file',
          }, { content: bytes, signal });
          return entry.path;
        } catch (error) {
          // Try a new name only when exclusive creation found an existing entry.
          if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
        }
      }
    },
    async withDocument(ref, signal, operation) {
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId));
      // Use the same lock as workspace entry removal and rename.
      return withFileStateUpdate(root, async () => {
        signal.throwIfAborted();
        const { target, stats } = await resolveDesignFile(root, ref.path);
        const key = await realpath(target);
        const read = async () => {
          signal.throwIfAborted();
          const file = await readWorkspaceFilePreview(target, ref.path, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES);
          if (file.preview?.kind !== 'text' || file.truncated || !file.revision) {
            throw new FeatureOperationFailure({
              code: 'INVALID_DESIGN_DOCUMENT', message: 'The design file could not be read as a workspace text file.', retryable: false,
            });
          }
          return { content: file.content, revision: file.revision };
        };
        return operation({
          key,
          read,
          async replace(content, expectedRevision) {
            await writeTextFile(target, content, {
              mode: stats.mode & 0o777,
              // Check again after staging the file, including on Windows rename retries.
              beforeReplace: async () => {
                const current = await resolveDesignFile(root, ref.path);
                if (current.target !== target || (await read()).revision !== expectedRevision) {
                  throw new FeatureOperationFailure({
                    code: 'REVISION_CONFLICT', message: 'The design changed on disk.', retryable: true,
                  });
                }
                signal.throwIfAborted();
              },
            });
            return createHash('sha256').update(content).digest('hex');
          },
        });
      });
    },
  };
}

async function resolveDesignFile(root: string, relativePath: string) {
  try {
    const entry = await resolveExistingWorkspaceEntry(root, relativePath);
    if (!entry.stats.isFile()) throw new Error('A design document must be a regular file.');
    return entry;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    throw new FeatureOperationFailure({ code: 'DESIGN_NOT_FOUND', message: 'The design file was not found.', retryable: false });
  }
}
