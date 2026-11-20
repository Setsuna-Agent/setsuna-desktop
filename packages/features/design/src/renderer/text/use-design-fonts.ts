import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { designFontNameKey, type DesignCustomFont } from '../../contracts/design-fonts.js';
import type { DesignDocument } from '../../contracts/index.js';
import type { DesignFontClient } from '../client.js';
import { DesignFontLoader, designFontRule, encodeDesignFont, matchDesignFontFaces, type DesignFontRequest } from './design-font-loader.js';
import { collectDesignTextFonts } from './design-typography.js';

const noFonts: readonly DesignCustomFont[] = [];

function collectDocumentFonts(document: DesignDocument, families: Set<string>) {
  for (const node of Object.values(document.nodes)) {
    if (node.kind === 'text') collectDesignTextFonts(node, families);
  }
  for (const style of Object.values(document.styles ?? {})) {
    if (style.kind === 'text' && style.typography.fontFamily) families.add(style.typography.fontFamily);
  }
}

export const DesignFontsContext = createContext<ReturnType<typeof useDesignFonts> | null>(null);

export function useDesignScriptFonts(results: ReadonlyMap<string, DesignDocument>) {
  const update = useContext(DesignFontsContext)?.updateScriptFonts;
  // Include newly generated text in the export readiness check before the next paint.
  useLayoutEffect(() => { update?.(results.values()); }, [results, update]);
}

export function useDesignFonts(client: DesignFontClient, document: DesignDocument | null, t: RendererTranslate) {
  const [catalog, setCatalog] = useState<readonly DesignCustomFont[]>();
  const [revision, setRevision] = useState(0);
  const listing = useRef<AbortController>();
  const active = useRef(false);
  const toast = useToast();
  const [scriptFamilies, setScriptFamilies] = useState<ReadonlySet<string>>(() => new Set());
  const updateScriptFonts = useCallback((documents: Iterable<DesignDocument>) => {
    const next = new Set<string>();
    for (const generated of documents) collectDocumentFonts(generated, next);
    setScriptFamilies((current) => current.size === next.size && [...next].every((family) => current.has(family)) ? current : next);
  }, []);
  const used = useMemo(() => {
    const families = new Set(scriptFamilies);
    if (document) collectDocumentFonts(document, families);
    return new Set([...families].map(designFontNameKey));
  }, [document, scriptFamilies]);
  const usedFamilies = useRef(used);
  useLayoutEffect(() => { usedFamilies.current = used; }, [used]);
  const changed = useCallback(() => setRevision((current) => current + 1), []);
  const loader = useMemo(() => new DesignFontLoader(client, ({ family }) => {
    // Registering a picker preview only affects layout if the canvas uses that family.
    if (usedFamilies.current.has(designFontNameKey(family))) changed();
  }), [client, changed]);
  const loadPreview = useCallback((font: DesignCustomFont) => loader.load(font), [loader]);
  const enabled = Boolean(document);
  const refresh = useCallback(async () => {
    if (!active.current) return;
    listing.current?.abort();
    const request = new AbortController();
    listing.current = request;
    try {
      const fonts = await client.list(request.signal);
      if (!request.signal.aborted) setCatalog(fonts);
    } catch {
      if (!request.signal.aborted) {
        setCatalog((current) => current ?? noFonts);
        toast.error(t('feature.design.loadFontsFailed'));
      }
    }
  }, [client, t, toast]);

  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('setsuna-design-fonts') : undefined;
    const reload = () => { void refresh(); };
    channel?.addEventListener('message', reload);
    window.addEventListener('focus', reload);
    reload();
    return () => {
      active.current = false;
      channel?.close();
      window.removeEventListener('focus', reload);
      listing.current?.abort();
    };
  }, [enabled, refresh]);
  useEffect(() => () => { loader.retain(noFonts); }, [loader]);

  const fonts = catalog ?? noFonts;
  const needed = useMemo(() => fonts.filter(({ family }) => used.has(designFontNameKey(family))), [fonts, used]);

  useEffect(() => {
    if (loader.retain(fonts)) changed();
  }, [changed, fonts, loader]);
  useEffect(() => {
    for (const font of needed) void loader.load(font);
  }, [loader, needed]);

  const updateCatalog = useCallback(async () => {
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel('setsuna-design-fonts');
      channel.postMessage(null);
      channel.close();
    }
    await refresh();
  }, [refresh]);

  const css = useCallback(async (requests: readonly DesignFontRequest[], exportFile = true) => {
    const rules: string[] = [];
    for (const font of matchDesignFontFaces(fonts, requests)) {
      if (exportFile && !font.embeddable) continue;
      const { base64 } = await client.read(font.id);
      rules.push(designFontRule(font, base64));
    }
    return rules.join('\n');
  }, [client, fonts]);

  const loading = Boolean(used.size && (!catalog || needed.some((font) => !loader.isSettled(font))));
  return useMemo(() => ({
    fonts, revision, loading, css, loadPreview, updateScriptFonts,
    choose: async (family: string) => {
      const key = designFontNameKey(family);
      const results = await Promise.all(fonts.filter((font) => designFontNameKey(font.family) === key).map((font) => loader.load(font, true)));
      return !results.length || results.some(Boolean);
    },
    import: async (file: File) => client.import(await encodeDesignFont(file)),
    remove: (id: string) => client.remove(id),
    updateCatalog,
  }), [client, css, fonts, loader, loading, loadPreview, revision, updateCatalog, updateScriptFonts]);
}
