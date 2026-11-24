import { useCallback, useEffect, useState } from 'react';
import { isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import { designDocumentFileExtension, type ProjectDesignEntry } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignRootDirectories } from './use-design-document-lists.js';

type ProjectDrafts = Readonly<{ projectId: string; entries: readonly ProjectDesignEntry[] }>;

export function useDesignProjectDrafts(client: DesignClient, projectId: string | undefined, roots: readonly string[],
  watchDirectories: WatchDesignRootDirectories, onError: (error: unknown) => void) {
  const [loaded, setLoaded] = useState<ProjectDrafts & { revision: number }>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const current = loaded?.projectId === projectId ? loaded : undefined;
  const loadedRevision = current?.revision;
  function rememberProjectDrafts(drafts: ProjectDrafts) { setLoaded({ ...drafts, revision }); }

  useEffect(() => { if (!projectId) setLoaded(undefined); }, [projectId]);
  useEffect(() => {
    if (!projectId || loadedRevision === revision) return;
    const controller = new AbortController();
    const { signal } = controller;
    void client.projectDesigns(projectId, signal).then((entries) => {
      if (!signal.aborted) setLoaded({ projectId, entries, revision });
    }).catch((error: unknown) => {
      if (!signal.aborted && !isFeatureOperationCancelled(error)) onError(error);
    });
    return () => controller.abort();
  }, [client, projectId, loadedRevision, revision, onError]);

  useEffect(() => {
    if (!projectId) return;
    const stops = roots.map((root) => watchDirectories(root, ['.'], refresh, {
      recursive: true, contentExtensions: [designDocumentFileExtension],
    }));
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      for (const stop of stops) stop();
    };
  }, [projectId, refresh, roots, watchDirectories]);

  return { projectDrafts: current?.entries, rememberProjectDrafts, refreshProjectDrafts: refresh };
}
