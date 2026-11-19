import { useEffect, useMemo, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignDocument, DesignDocumentRef, DesignScriptInputs, DesignScriptParameter, DesignScriptValue } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import { roundDesignValue } from '../design-geometry.js';
import type { WatchDesignDirectories } from '../design-images.js';
import type { DesignScene } from '../design-layout.js';
import { withDesignScriptInput, type DesignScriptResults } from './design-script-layers.js';
import { designScriptDirectory } from './design-script-source.js';

export type DesignScriptParameterPreview = Readonly<{
  id: string; scriptPath: string; owner: string; parameter: DesignScriptParameter; value: DesignScriptValue;
}>;
type Request = readonly [id: string, scriptPath: string, width: number, height: number, inputs?: DesignScriptInputs];
type ScriptScene = Readonly<{ document: DesignDocument; scene: DesignScene }>;
type RenderedScript = Readonly<{ key: string; path: string; document?: DesignDocument }>;
type LoadedScripts = ReadonlyMap<string, RenderedScript>;
const emptyResults: DesignScriptResults = new Map();

function scriptRequests({ document, scene }: ScriptScene, preview?: DesignScriptParameterPreview) {
  return Object.entries(document.nodes).flatMap(([id, node]): Request[] => {
    const box = scene[id];
    if (node.kind !== 'script' || !node.scriptPath || !box?.visible) return [];
    const inputs = preview?.id === id && preview.scriptPath === node.scriptPath
      ? withDesignScriptInput(node.scriptInputs, preview.parameter, preview.value) : node.scriptInputs;
    return [[id, node.scriptPath, Math.max(0.01, roundDesignValue(box.width)), Math.max(0.01, roundDesignValue(box.height)), inputs]];
  });
}

export function useDesignScriptResults(client: DesignClient, ref: DesignDocumentRef, source: ScriptScene,
  watchDirectories: WatchDesignDirectories | undefined, translate: RendererTranslate,
  canvas: ScriptScene & Readonly<{ preview?: DesignScriptParameterPreview }>,
) {
  const toast = useToast();
  const [sourceVersion, setSourceVersion] = useState(0);
  const { document, scene, preview } = canvas;
  const draftId = preview?.id;
  const requestsKey = useMemo(() => JSON.stringify(scriptRequests({ document, scene }, preview)), [document, preview, scene]);
  const outputKey = useMemo(() => !preview && source.document === document && source.scene === scene
    ? requestsKey : JSON.stringify(scriptRequests({ document: source.document, scene: source.scene })),
  [document, preview, requestsKey, scene, source.document, source.scene]);
  const requests = useMemo(() => (JSON.parse(requestsKey) as Request[]).map((request) => {
    const [id, scriptPath, width, height, inputs] = request;
    return { id, key: JSON.stringify([sourceVersion, request]), input: { ref, scriptPath, width, height, ...(inputs ? { inputs } : {}) } };
  }), [ref, requestsKey, sourceVersion]);
  const directoriesKey = JSON.stringify([...new Set(requests.map(({ input }) => designScriptDirectory(input.scriptPath)))]);
  const visibleScriptsKey = JSON.stringify(requests.map(({ id, input }) => [id, input.scriptPath]));
  // The editor remounts on file or document changes, discarding this cache.
  const [loaded, setLoaded] = useState<LoadedScripts>();
  const cache = useRef<LoadedScripts>();

  useEffect(() => {
    if (directoriesKey === '[]') return;
    return watchDirectories?.(JSON.parse(directoriesKey) as string[], () => setSourceVersion((version) => version + 1), { contentExtensions: ['.js'] });
  }, [directoriesKey, watchDirectories]);

  useEffect(() => {
    const previous = cache.current;
    const entries = new Map(requests.flatMap(({ id }) => {
      const entry = previous?.get(id);
      return entry ? [[id, entry] as const] : [];
    }));
    const pending = requests.filter(({ id, key }) => entries.get(id)?.key !== key);
    function publish() {
      const next = new Map(entries);
      cache.current = next;
      setLoaded(next);
    }
    if (!pending.length) {
      if (previous && entries.size !== previous.size) publish();
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    async function evaluate() {
      let failed = false;
      // Each evaluation borrows a worker. Keep a large draft from using the entire pool.
      for (let start = 0; start < pending.length; start += 2) {
        const batch = pending.slice(start, start + 2);
        const results = await Promise.allSettled(batch.map(async ({ input }) => client.renderScript(input, signal)));
        if (signal.aborted) return;
        results.forEach((result, index) => {
          const { id, key, input } = batch[index];
          // Partial text edits may be invalid. Keep the previous drawing until a committed value is evaluated.
          if (result.status === 'rejected' && id === draftId) return;
          const rendered = result.status === 'fulfilled' ? result.value : undefined;
          entries.set(id, { key, path: input.scriptPath, document: rendered });
          if (!rendered) failed = true;
        });
        publish();
      }
      if (failed) toast.error(translate('feature.design.scriptFailed'));
    }
    const timer = draftId ? setTimeout(() => { void evaluate(); }, 100) : undefined;
    if (!draftId) void evaluate();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [client, draftId, requests, toast, translate]);

  // Pending parameter edits keep the same canvas scene until a drawing actually changes.
  const rendered = useMemo(() => {
    if (!loaded) return emptyResults;
    const rendered = new Map<string, DesignDocument>();
    for (const [id, path] of JSON.parse(visibleScriptsKey) as [string, string][]) {
      const entry = loaded.get(id);
      if (entry?.path === path && entry.document) rendered.set(id, entry.document);
    }
    return rendered;
  }, [loaded, visibleScriptsKey]);
  const { current, pending } = useMemo(() => {
    const current = new Map<string, DesignDocument>();
    const pending = new Set<string>();
    // Output uses the document's exact inputs, including resolved layout and script source version.
    for (const request of JSON.parse(outputKey) as Request[]) {
      const [id] = request;
      const entry = loaded?.get(id);
      if (entry?.key !== JSON.stringify([sourceVersion, request])) pending.add(id);
      else if (entry.document) current.set(id, entry.document);
    }
    return { current, pending };
  }, [loaded, outputKey, sourceVersion]);
  return { rendered, current, pending };
}
