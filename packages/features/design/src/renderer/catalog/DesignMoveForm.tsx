import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { DesignWorkspace as DesignScope } from '../../contracts/index.js';
import { DesignScopeFields, designDestination, type DesignCatalogProject } from './DesignScopeFields.js';

export function DesignMoveForm({ projects, pending, onMove, onClose, translate: t }: Readonly<{
  projects: readonly DesignCatalogProject[];
  pending: boolean;
  onMove(destination: DesignScope): void;
  onClose(): void;
  translate: RendererTranslate;
}>) {
  const [selection, setSelection] = useState<DesignScope | null>(null);
  const destination = designDestination(projects, selection);

  return <div className="design-popover-form">
    <DesignScopeFields projects={projects} scope={selection} mode="choose" disabled={pending} onChange={setSelection} translate={t} />
    <div className="design-popover-form__actions">
      <Button size="small" disabled={pending} onClick={onClose}>{t('feature.design.cancel')}</Button>
      <Button size="small" variant="primary" disabled={!destination} loading={pending} onClick={() => { if (destination) onMove(destination); }}>
        {t('feature.design.moveDocumentConfirm')}
      </Button>
    </div>
  </div>;
}
