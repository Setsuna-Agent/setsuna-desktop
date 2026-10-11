import type { PluginUiDocument } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';

export function usePluginUiDocument(html: string | undefined, storageKey: string) {
  const create = window.setsunaDesktop?.desktop.createPluginUiDocument;
  const release = window.setsunaDesktop?.desktop.releasePluginUiDocument;
  const [state, setState] = useState<{ html: string; storageKey: string; document?: PluginUiDocument; error?: string }>();
  useEffect(() => {
    if (!create || !release || html === undefined) return;
    let disposed = false;
    let document: PluginUiDocument | undefined;
    void create({ html, storageKey }).then(value => {
      document = value;
      if (disposed) void release(value.id).catch(console.error);
      else setState({ html, storageKey, document: value });
    }).catch((error: unknown) => {
      if (!disposed) setState({ html, storageKey, error: error instanceof Error ? error.message : 'Plugin page is unavailable.' });
    });
    return () => {
      disposed = true;
      if (document) void release(document.id).catch(console.error);
    };
  }, [create, html, release, storageKey]);
  if (!create || !release) return { error: 'Plugin pages require Setsuna Desktop.' };
  // Never mount a previous document while its replacement is being registered.
  return state && state.html === html && state.storageKey === storageKey
    ? { url: state.document?.url, error: state.error }
    : {};
}
