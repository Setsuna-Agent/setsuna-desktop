import { Frame } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designGridSpacingRange, useDesignCanvasSettings } from '../context/design-canvas-settings.js';

export function DesignEmptyProjectCanvas({ toolbar, showEmptyState, translate: t }: Readonly<{
  toolbar: ReactNode; showEmptyState: boolean; translate: RendererTranslate;
}>) {
  const { settings } = useDesignCanvasSettings();
  const gridStep = settings.grid === 'hidden' ? designGridSpacingRange.initial : settings.gridSpacing[settings.grid];
  return <div className="design-workspace__editing">
    {toolbar}
    <div className="design-editor__stage design-workspace__empty" role="region" aria-label={t('feature.design.canvas')}
      data-design-background={settings.background} data-design-appearance={settings.appearance} data-design-grid={settings.grid}
      style={{ '--design-grid-step': `${gridStep}px` } as CSSProperties}>
      {showEmptyState && <div className="design-workspace__empty-placeholder">
        <Frame size={24} strokeWidth={1.5} aria-hidden="true" />
        <span>{t('feature.design.noProjectDrafts')}</span>
      </div>}
    </div>
  </div>;
}
