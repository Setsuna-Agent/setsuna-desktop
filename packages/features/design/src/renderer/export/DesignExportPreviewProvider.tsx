import { createContext, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignExportInput, DesignPreparedExport } from '../../contracts/design-export.js';
import type { DesignAssets } from '../client.js';

const DesignExportDialog = lazy(() => import('./DesignExportDialog.js'));

type PresentDesignExport = (generate: (signal: AbortSignal) => Promise<DesignExportInput>, signal: AbortSignal) => Promise<boolean>;
export const DesignExportPreviewContext = createContext<PresentDesignExport | null>(null);

type ExportSession = { id: string; dispose(): void; saved(): void };
type ExportPreview = { id: string; prepared: { input: DesignExportInput; file: DesignPreparedExport } | null };

export function DesignExportPreviewProvider({ assets, visible, translate: t, children }: Readonly<{
  assets: DesignAssets;
  visible: boolean;
  translate: RendererTranslate;
  children: ReactNode;
}>) {
  const bridge = assets.publication;
  const session = useRef<ExportSession>();
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const close = useCallback(() => {
    const current = session.current;
    if (!current) return;
    session.current = undefined;
    current.dispose();
    setPreview(null);
  }, []);
  useLayoutEffect(() => { if (!visible) close(); }, [visible, close]);
  useEffect(() => () => { session.current?.dispose(); session.current = undefined; }, []);

  const present: PresentDesignExport = async (generate, parentSignal) => {
    if (!bridge) return false;
    if (session.current) throw new Error(t('feature.design.exportPreview.busy'));
    parentSignal.throwIfAborted();
    const id = crypto.randomUUID();
    const controller = new AbortController();
    let complete!: (saved: boolean) => void;
    let fail!: (error: unknown) => void;
    const completion = new Promise<boolean>((resolve, reject) => { complete = resolve; fail = reject; });
    const detach = () => parentSignal.removeEventListener('abort', close);
    const current = {
      id,
      dispose() {
        detach();
        controller.abort();
        void bridge.closeExport(id).catch(() => undefined);
        complete(false);
      },
      saved() {
        // A caller can finish after Save As while the user keeps using the preview.
        detach();
        complete(true);
      },
    };
    session.current = current;
    parentSignal.addEventListener('abort', close, { once: true });
    setPreview({ id, prepared: null });
    void (async () => {
      try {
        const input = await generate(controller.signal);
        controller.signal.throwIfAborted();
        const file = await bridge.prepareExport(id, input);
        if (session.current !== current) return;
        if (file) setPreview({ id, prepared: { input, file } });
        else close();
      } catch (error) {
        if (session.current !== current) return;
        fail(error);
        close();
      }
    })();
    return completion;
  };
  return <DesignExportPreviewContext.Provider value={typeof bridge?.prepareExport === 'function' ? present : null}>
    {children}
    {preview && bridge ? <Suspense fallback={null}><DesignExportDialog key={preview.id} requestId={preview.id}
      prepared={preview.prepared} bridge={bridge} output={assets.output} translate={t} onClose={close}
      onSaved={() => { if (session.current?.id === preview.id) session.current.saved(); }} /></Suspense> : null}
  </DesignExportPreviewContext.Provider>;
}
