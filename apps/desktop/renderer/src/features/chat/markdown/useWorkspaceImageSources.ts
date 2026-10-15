import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { resolveMarkdownLinkTarget } from './markdownLinks.js';
import { createWorkspaceImagePreviews, imageHttpUrl, type WorkspaceImageSource } from './workspaceImagePreviews.js';

/** Both Markdown and generated components use the same workspace/preview boundary. */
export function useWorkspaceImageSources(sources: readonly (string | undefined)[]): Map<string | undefined, WorkspaceImageSource> {
  const { workspaceRoot, workspaceFiles } = useMarkdownNavigation();
  const sourceKey = JSON.stringify([...new Set(sources.filter((source): source is string => typeof source === 'string'))]);
  const targets = useMemo(() => new Map((JSON.parse(sourceKey) as string[])
    .map((source) => [source, resolveMarkdownLinkTarget(source, workspaceRoot)])), [sourceKey, workspaceRoot]);
  const paths = useMemo(() => [...new Set([...targets.values()]
    .flatMap((target) => target.kind === 'workspace' ? [target.path] : []))], [targets]);
  const previews = useMemo(() => createWorkspaceImagePreviews(workspaceRoot, workspaceFiles,
    typeof window === 'undefined' ? undefined : window.setsunaDesktop?.desktop), [workspaceRoot, workspaceFiles]);
  const snapshot = useSyncExternalStore(previews.subscribe, previews.getSnapshot, previews.getSnapshot);
  useEffect(() => { previews.setPaths(paths); }, [paths, previews]);
  useEffect(() => () => previews.dispose(), [previews]);

  return new Map([...targets].map(([input, target]) => {
    if (target.kind === 'external') return [input, { source: imageHttpUrl(target.href) }];
    return [input, target.kind === 'workspace' ? snapshot.get(target.path) ?? {} : {}];
  }));
}
