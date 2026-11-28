import { CircleStop } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignPublicationBridge } from '../../contracts/design-publication.js';

// The published snapshot can outlive its source, including when the last draft is deleted.
export function DesignStopPreviewAction({ bridge, translate: t }: Readonly<{
  bridge: Pick<DesignPublicationBridge, 'previewStatus' | 'stopPreview'>;
  translate: RendererTranslate;
}>) {
  const [id, setId] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const statusRequest = useRef(0);
  const toast = useToast();

  useEffect(() => {
    const refresh = () => {
      const request = ++statusRequest.current;
      void bridge.previewStatus().then((status) => {
        if (request === statusRequest.current) setId(status?.id);
      }).catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      statusRequest.current += 1;
      window.removeEventListener('focus', refresh);
    };
  }, [bridge]);

  async function stop() {
    if (!id || stopping) return;
    setStopping(true);
    try {
      await bridge.stopPreview(id);
      statusRequest.current += 1;
      setId((current) => current === id ? undefined : current);
    } catch (error) {
      toast.error(t('feature.design.publication.accessFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setStopping(false);
    }
  }

  return id ? <IconButton size="small" label={t('feature.design.publication.stop')} disabled={stopping} onClick={() => { void stop(); }}>
    <CircleStop size={16} aria-hidden="true" />
  </IconButton> : null;
}
