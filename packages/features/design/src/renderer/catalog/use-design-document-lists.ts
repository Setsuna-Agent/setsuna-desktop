import { useEffect, useRef, useState } from 'react';
import { workspaceFilePathKey, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import { designDocumentFileExtension, type DesignWorkspace } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignDirectories } from '../design-images.js';

export type DesignListingScope = Readonly<{ scope: DesignWorkspace; root: WorkspaceProjectRoot; source: readonly string[] }>;
export type WatchDesignRootDirectories = (root: string, ...args: Parameters<WatchDesignDirectories>) => ReturnType<WatchDesignDirectories>;

export function designListingKey({ root }: DesignListingScope): string {
  return workspaceFilePathKey(root.path, '.');
}

const concurrentListings = 4;

export function useDesignDocumentLists(client: DesignClient, scopes: readonly DesignListingScope[],
  watchDirectories: WatchDesignRootDirectories | undefined, onError: (error: unknown) => void) {
  const [lists, setLists] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map());
  const scheduleRefresh = useRef<() => void>();
  useEffect(() => {
    if (!scopes.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    const pending = new Map<string, DesignListingScope>();
    const running = new Set<string>();
    const failed = new Set<string>();
    const watchers = new Map<string, () => void>();

    function drain() {
      if (signal.aborted) return;
      for (const [key, scope] of pending) {
        if (running.size >= concurrentListings) break;
        if (running.has(key)) continue;
        pending.delete(key);
        running.add(key);
        const { root } = scope;
        void client.list(scope.scope, signal).then((paths) => {
          if (signal.aborted) return;
          failed.delete(key);
          setLists((current) => {
            const previous = current.get(key);
            return previous?.length === paths.length && previous.every((path, index) => path === paths[index])
              ? current : new Map(current).set(key, paths);
          });
          if (watchDirectories && !watchers.has(key)) {
            watchers.set(key, watchDirectories(root.path, ['.'], () => schedule([scope]), {
              recursive: true, contentExtensions: [designDocumentFileExtension],
            }));
          }
        }).catch((error: unknown) => {
          if (signal.aborted || failed.has(key)) return;
          failed.add(key);
          onError(error);
        }).finally(() => {
          running.delete(key);
          drain();
        });
      }
    }

    function schedule(next: readonly DesignListingScope[]) {
      for (const scope of next) {
        const key = designListingKey(scope);
        if (!pending.has(key)) pending.set(key, scope);
      }
      drain();
    }

    const refresh = () => schedule(scopes);
    scheduleRefresh.current = refresh;
    refresh();
    if (watchDirectories) window.addEventListener('focus', refresh);
    return () => {
      scheduleRefresh.current = undefined;
      controller.abort();
      window.removeEventListener('focus', refresh);
      for (const stop of watchers.values()) stop();
    };
  }, [client, scopes, watchDirectories, onError]);
  return { lists, refresh: () => scheduleRefresh.current?.() };
}
