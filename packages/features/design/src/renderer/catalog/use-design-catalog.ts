import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceFilePathKey, workspaceProjectRoots, workspaceRootName, type WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignCatalog, DesignDirectory, DesignDocumentRef } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import { designListingKey, type DesignListingScope } from './use-design-document-lists.js';

const emptyCatalog: DesignCatalog & { ready: boolean } = { directories: [], associations: [], ready: false };

export function useDesignCatalog(client: DesignClient, projects: readonly WorkspaceProject[], translate: RendererTranslate, onError: (error: unknown) => void) {
  const [catalog, setCatalog] = useState(emptyCatalog);
  const request = useRef<AbortController>();
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await client.catalog(controller.signal);
      if (!controller.signal.aborted) setCatalog((previous) => ({
        ...next, ready: true, directories: previous.directories.length === next.directories.length && next.directories.every((entry, index) =>
          entry.id === previous.directories[index].id && entry.path === previous.directories[index].path) ? previous.directories : next.directories,
      }));
    } catch (error) { if (!controller.signal.aborted) onError(error); }
  }, [client, onError]);
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { request.current?.abort(); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  function rememberDirectory(directory: DesignDirectory) {
    setCatalog((previous) => previous.directories.some(({ id }) => id === directory.id)
      ? previous : { ...previous, directories: [...previous.directories, directory] });
  }
  const scopes = useMemo<DesignListingScope[]>(() => [
    ...projects.flatMap((project) => {
      const roots = workspaceProjectRoots(project);
      return roots.map((root) => ({ scope: { projectId: project.id, rootId: root.id }, root,
        source: roots.length > 1 ? [project.name, workspaceRootName(root)] : [project.name] }));
    }),
    ...catalog.directories.map((root) => ({ scope: { storageId: root.id }, root,
      source: [root.id === 'local' ? translate('feature.design.localDesigns') : workspaceRootName(root)] })),
  ], [catalog.directories, projects, translate]);
  const associations = useMemo(() => new Map(catalog.associations.map(({ file, projectId }) => [workspaceFilePathKey(file, '.'), projectId])), [catalog.associations]);
  const projectFor = useCallback((ref: DesignDocumentRef, root: string) => {
    const key = workspaceFilePathKey(root, ref.path);
    return associations.has(key) ? associations.get(key) : ref.projectId;
  }, [associations]);
  const mayContainProjectDrafts = useCallback((listing: DesignListingScope, projectIds: ReadonlySet<string>) => {
    if (listing.scope.projectId && projectIds.has(listing.scope.projectId)) return true;
    const directory = designListingKey(listing);
    const prefix = directory.endsWith('/') ? directory : `${directory}/`;
    // A draft linked to this project can be stored under a different listing root.
    for (const [file, linkedProject] of associations) {
      if (linkedProject && projectIds.has(linkedProject) && file.startsWith(prefix)) return true;
    }
    return false;
  }, [associations]);
  return { scopes, projectFor, mayContainProjectDrafts, catalogReady: catalog.ready, refresh, rememberDirectory };
}
