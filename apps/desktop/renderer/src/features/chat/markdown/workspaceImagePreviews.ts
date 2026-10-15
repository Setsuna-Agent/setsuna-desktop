import type { SetsunaDesktopBridge } from '@setsuna-desktop/contracts';
import type { MarkdownWorkspaceFiles } from './useMarkdownWorkspaceFiles.js';

export type WorkspaceImageSource = { source?: string; filePath?: string };
type Preview = { previewId?: string; source?: string };
type PreviewBridge = Pick<SetsunaDesktopBridge['desktop'], 'createWorkspaceFilePreview' | 'releaseWorkspaceFilePreview'>;

/** Own subscriptions and native registrations for one mounted image consumer. */
export function createWorkspaceImagePreviews(root: string | undefined, files: MarkdownWorkspaceFiles | undefined, desktop: PreviewBridge | undefined) {
  const subscriptions = new Map<string, () => void>();
  const previews = new Map<string, Preview>();
  const listeners = new Set<() => void>();
  let snapshot = new Map<string, WorkspaceImageSource>();

  const release = (id: string) => { void desktop?.releaseWorkspaceFilePreview(id).catch(() => undefined); };
  const publish = () => {
    const next = new Map([...subscriptions.keys()].map((path) => {
      const filePath = files?.get(path) ?? undefined;
      return [path, { filePath, source: filePath ? previews.get(filePath)?.source : undefined }] as const;
    }));
    if (next.size === snapshot.size && [...next].every(([path, value]) => {
      const previous = snapshot.get(path);
      return previous && previous.filePath === value.filePath && previous.source === value.source;
    })) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    const available = new Set([...subscriptions.keys()].flatMap((path) => {
      const file = files?.get(path);
      return file ? [file] : [];
    }));
    for (const [path, preview] of previews) {
      if (available.has(path)) continue;
      previews.delete(path);
      if (preview.previewId) release(preview.previewId);
    }
    if (root && desktop) for (const path of available) {
      if (previews.has(path)) continue;
      const preview: Preview = {};
      previews.set(path, preview);
      // Native validation remains responsible for workspace and symlink boundaries.
      void desktop.createWorkspaceFilePreview(root, path).then((result) => {
        if (!result.ok) return;
        const source = imageHttpUrl(result.url);
        // Removed paths and closed consumers still own any late IPC registration.
        if (previews.get(path) !== preview || !source) { release(result.previewId); return; }
        preview.previewId = result.previewId;
        preview.source = source;
        publish();
      }).catch(() => undefined);
    }
    publish();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPaths(paths: readonly string[]) {
      const next = new Set(paths);
      // Add before removing so a still-used directory never loses its shared listing.
      for (const path of next) if (!subscriptions.has(path)) {
        // Each path needs its own listener identity in the directory's listener set.
        subscriptions.set(path, files?.subscribe(path, () => refresh()) ?? (() => undefined));
      }
      for (const [path, stop] of subscriptions) if (!next.has(path)) {
        subscriptions.delete(path);
        stop();
      }
      refresh();
    },
    dispose() {
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
      for (const preview of previews.values()) if (preview.previewId) release(preview.previewId);
      previews.clear();
      snapshot = new Map();
    },
  };
}

export function imageHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    // OpenUI also interpolates these URLs in unquoted CSS url(...).
    return url.href.replace(/[()'"\\]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return undefined; }
}
