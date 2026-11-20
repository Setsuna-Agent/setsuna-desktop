import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { designLayerShaderPaths, type DesignDocument, type DesignDocumentRef } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignDirectories } from '../design-images.js';
import type { DesignShaderSources } from './design-shader-renderer.js';

type DesignShaderAssets = Readonly<{
  sources: DesignShaderSources;
  paths: readonly string[];
  read(path: string, signal?: AbortSignal): Promise<string>;
  store(file: { name: string; source: string }, signal?: AbortSignal): Promise<string>;
  remember(path: string, source: string): void;
}>;

export const DesignShaderAssetsContext = createContext<DesignShaderAssets | undefined>(undefined);
const emptySources: DesignShaderSources = new Map();

export function useDesignShaderAssets(client: DesignClient, ref: DesignDocumentRef, document: DesignDocument | null,
  watchDirectories?: WatchDesignDirectories): DesignShaderAssets {
  const [loaded, setLoaded] = useState<{ ref: DesignDocumentRef; sources: DesignShaderSources }>();
  const pathKey = useMemo(() => {
    const paths = new Set<string>();
    for (const node of Object.values(document?.nodes ?? {})) designLayerShaderPaths(node).forEach((path) => paths.add(path));
    return JSON.stringify([...paths].sort());
  }, [document]);
  const paths = useMemo(() => JSON.parse(pathKey) as string[], [pathKey]);

  const read = useCallback((shaderPath: string, signal?: AbortSignal) => client.readShader({ ...ref, shaderPath }, signal), [client, ref]);
  const store = useCallback((input: { name: string; source: string }, signal?: AbortSignal) => client.importShader({ ref, ...input }, signal), [client, ref]);
  const remember = useCallback((path: string, source: string) => {
    setLoaded((current) => {
      if (current?.ref === ref && current.sources.get(path) === source) return current;
      return { ref, sources: new Map(current?.ref === ref ? current.sources : undefined).set(path, source) };
    });
  }, [ref]);

  useEffect(() => {
    if (!paths.length) return;
    let request: AbortController | undefined;
    function refresh() {
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      for (const path of paths) void read(path, signal).then((source) => {
        if (!signal.aborted) remember(path, source);
      }).catch(() => {
        if (signal.aborted) return;
        setLoaded((current) => {
          if (current?.ref !== ref || !current.sources.has(path)) return current;
          const sources = new Map(current.sources);
          sources.delete(path);
          return { ref, sources };
        });
      });
    }
    refresh();
    const directories = [...new Set(paths.map((path) => path.slice(0, path.lastIndexOf('/') + 1).replace(/\/$/u, '') || '.'))];
    const unwatch = watchDirectories?.(directories, refresh, { contentExtensions: ['.glsl'] });
    return () => { request?.abort(); unwatch?.(); };
  }, [paths, read, ref, remember, watchDirectories]);

  return useMemo(() => ({ sources: loaded?.ref === ref ? loaded.sources : emptySources, paths, read, store, remember }),
    [loaded, paths, read, ref, remember, store]);
}
