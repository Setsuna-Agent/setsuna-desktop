import { maxDesignScriptBytes, maxDesignShaderBytes } from '@setsuna-desktop/feature-design/contracts';
import { isNodeError } from '../../shared/node-errors.js';
import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { readWorkspaceFilePreview } from './workspace-file-preview-reader.js';

export async function readWorkspaceDesignSource(root: string, relativePath: string, maxBytes: number) {
  const { target, stats } = await resolveExistingWorkspaceEntry(root, relativePath);
  if (!stats.isFile() || stats.size > maxBytes) throw new Error('Design source file exceeds the size limit.');
  const file = await readWorkspaceFilePreview(target, relativePath, maxBytes);
  if (file.preview?.kind !== 'text' || file.truncated) throw new Error('Expected a design source text file.');
  return { content: file.content, revision: file.revision };
}

// A shared directory can reuse a deleted import's filename for another draft. Scope the grant to its original bytes.
export async function readVerifiedDesignImport(root: string, path: string, revision: string) {
  try {
    const { target } = await resolveExistingWorkspaceEntry(root, path);
    const file = await readWorkspaceFilePreview(target, path, Math.max(maxDesignScriptBytes, maxDesignShaderBytes));
    if (file.revision !== revision) return;
    if (file.preview?.kind === 'image' || (file.preview?.kind === 'text' && !file.truncated)) return file;
  } catch (error) {
    // The workspace resolver also rejects symlinks and other non-regular entries.
    // Stale optional imports can be skipped; filesystem I/O failures still propagate.
    if (isNodeError(error) && error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && error.code !== 'ELOOP') throw error;
  }
}
