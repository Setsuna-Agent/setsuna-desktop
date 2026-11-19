import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { readWorkspaceFilePreview } from './workspace-file-preview-reader.js';

export async function readWorkspaceDesignSource(root: string, relativePath: string, maxBytes: number) {
  const { target, stats } = await resolveExistingWorkspaceEntry(root, relativePath);
  if (!stats.isFile() || stats.size > maxBytes) throw new Error('Design source file exceeds the size limit.');
  const file = await readWorkspaceFilePreview(target, relativePath, maxBytes);
  if (file.preview?.kind !== 'text' || file.truncated) throw new Error('Expected a design source text file.');
  return { content: file.content, revision: file.revision };
}
