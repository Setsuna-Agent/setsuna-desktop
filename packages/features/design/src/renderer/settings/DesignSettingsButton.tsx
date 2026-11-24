import { lazy, Suspense, useState } from 'react';
import { Settings } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';

const DesignSettingsDialog = lazy(() => import('./DesignSettingsDialog.js'));

export function DesignSettingsButton({ visible = true, translate: t }: Readonly<{ visible?: boolean; translate: RendererTranslate }>) {
  const [open, setOpen] = useState(false);
  if (!visible && open) setOpen(false);
  return <>
    <IconButton size="small" label={t('feature.design.settings.title')} aria-haspopup="dialog"
      aria-expanded={open} onClick={() => setOpen(true)}><Settings size={16} aria-hidden="true" /></IconButton>
    {visible && open ? <Suspense fallback={null}><DesignSettingsDialog onClose={() => setOpen(false)} translate={t} /></Suspense> : null}
  </>;
}
