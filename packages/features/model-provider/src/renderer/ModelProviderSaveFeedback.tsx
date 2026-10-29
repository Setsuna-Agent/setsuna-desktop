import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { useEffect } from 'react';
import { useModelProviderRendererService, useModelProviderSnapshot } from './context.js';

/** Mounted by the host beside its toast provider, independently of the settings route. */
export function ModelProviderSaveFeedback({ translate }: { translate: RendererTranslate }) {
  const service = useModelProviderRendererService();
  const { saveError } = useModelProviderSnapshot(service);
  const toast = useToast();
  useEffect(() => {
    if (!saveError) return;
    const id = toast.error(translate('feature.modelProvider.saveFailed', { message: saveError }), {
      durationMs: null,
      action: {
        label: translate('feature.modelProvider.retrySave'),
        onClick: () => { void service.commit().catch(() => undefined); },
      },
    });
    return () => { if (id !== null) toast.dismiss(id); };
  }, [saveError, service, toast, translate]);
  return null;
}
