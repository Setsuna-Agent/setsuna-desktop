import { useEffect, useState } from 'react';
import { ToastNotice } from '../toast/provider.js';

export type HtmlFilePreviewResource = { url: string; dispose(): void };

export function HtmlFilePreview({ title, loadPreview }: {
  title: string;
  loadPreview(): Promise<HtmlFilePreviewResource>;
}) {
  const [loaded, setLoaded] = useState<{
    loader: typeof loadPreview;
    preview?: HtmlFilePreviewResource;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let resource: HtmlFilePreviewResource | undefined;
    void loadPreview().then((preview) => {
      // IPC can finish after a tab or Git version changes. Release its token without mounting it.
      if (!active) { preview.dispose(); return; }
      resource = preview;
      setLoaded({ loader: loadPreview, preview });
    }).catch((error: unknown) => {
      if (active) setLoaded({ loader: loadPreview, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; resource?.dispose(); };
  }, [loadPreview]);

  const current = loaded?.loader === loadPreview ? loaded : null;
  return <div className="sd-html-file-preview" aria-busy={!current || undefined}>
    <ToastNotice message={current?.error} />
    {current?.preview ? <iframe key={current.preview.url} title={title} src={current.preview.url}
      sandbox="allow-scripts" referrerPolicy="no-referrer" /> : null}
  </div>;
}
