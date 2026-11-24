import path from 'node:path';
import { workspaceFilePathKey, workspaceProjectRoots } from '@setsuna-desktop/contracts';
import { chatDesignTitle, isDesignDocumentPath, isDesignLibraryPresetDocumentId, type ProjectDesignEntry, type DesignWorkspace } from '@setsuna-desktop/feature-design/contracts';
import type { FileWorkspaceProjectStore } from './file-workspace-project-store.js';
import type { designStorageDirectories } from './design-storage-directories.js';
import { readDraftId, type DesignResourceOwnership } from './design-workspace-resource-root.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';

export async function listLinkedDesigns(projects: Pick<FileWorkspaceProjectStore, 'listProjects'>,
  storage: ReturnType<typeof designStorageDirectories>, ownership: DesignResourceOwnership, projectId: string, signal: AbortSignal) {
  const [{ projects: available }, directories, associations] = await Promise.all([
    projects.listProjects(), storage.list(), ownership.associations(signal, projectId),
  ]);
  const project = available.find((entry) => entry.id === projectId);
  if (!project) return [];
  const results = new Map<string, ProjectDesignEntry>();
  const scopes = new Map<string, DesignWorkspace>();
  for (const entry of available) {
    for (const root of workspaceProjectRoots(entry)) scopes.set(workspaceFilePathKey(root.path, '.'), { projectId: entry.id, rootId: root.id });
  }
  for (const dir of directories) scopes.set(workspaceFilePathKey(dir.path, '.'), { storageId: dir.id });
  // Explicitly linked drafts may live outside all roots of this project. Their saved resource root
  // is also the base for image and library paths when the canvas opens.
  for (const { file, root, id } of associations) {
    if (isDesignLibraryPresetDocumentId(id)) continue;
    const scope = scopes.get(workspaceFilePathKey(root, '.'));
    if (scope) results.set(workspaceFilePathKey(file, '.'), { ref: { ...scope, path: relative(root, file) }, documentId: id, directory: path.dirname(file) });
  }
  for (const root of workspaceProjectRoots(project)) {
    await walkWorkspaceFiles(root.path, async (file) => {
      const key = workspaceFilePathKey(file, '.');
      if (!isDesignDocumentPath(file) || results.has(key)) return true;
      const ref = { projectId, rootId: root.id, path: relative(root.path, file) };
      const documentId = await readDraftId(file).catch(() => undefined);
      if (documentId && !isDesignLibraryPresetDocumentId(documentId)) {
        const linked = await ownership.project(file, documentId);
        if (linked === undefined || linked === projectId) results.set(key, { ref, documentId, directory: path.dirname(file) });
      }
      return true;
    }, { signal });
  }
  signal.throwIfAborted();
  const titleCounts = new Map<string, number>();
  const entries = [...results.values()].sort((a, b) => a.ref.path.localeCompare(b.ref.path));
  for (const entry of entries) {
    const title = chatDesignTitle(entry).toLowerCase();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  return entries.map(({ directory, ...owner }) => (titleCounts.get(chatDesignTitle(owner).toLowerCase()) ?? 0) > 1 ? { ...owner, directory } : owner);
}

function relative(root: string, file: string) { return path.relative(root, file).split(path.sep).join('/'); }
