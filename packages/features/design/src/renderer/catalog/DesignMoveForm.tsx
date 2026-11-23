import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentRef, DesignDirectory, DesignWorkspace } from '../../contracts/index.js';
import { DesignLocationField, type DesignLocationPicker } from './DesignLocationField.js';

export function DesignMoveForm({ choose, source, pending, onMove, onClose, translate: t }: Readonly<{
  choose: DesignLocationPicker; source: DesignDocumentRef; pending: boolean; onMove(destination: DesignWorkspace): void;
  onClose(): void; translate: RendererTranslate;
}>) {
  const [directory, setDirectory] = useState<DesignDirectory | null>(null);
  const storageId = directory?.id ?? 'local';
  const sameFile = source.storageId === storageId && !source.path.includes('/');
  return <div className="design-popover-form">
    <div className="design-location-footer">
      <DesignLocationField directory={directory} choose={choose} onChange={setDirectory} disabled={pending} translate={t} />
      <Button size="small" variant="ghost" disabled={pending} onClick={onClose}>{t('feature.design.cancel')}</Button>
      <Button size="small" variant="primary" disabled={sameFile} loading={pending} onClick={() => onMove({ storageId })}>
        {t('feature.design.moveDocumentConfirm')}
      </Button>
    </div>
  </div>;
}
