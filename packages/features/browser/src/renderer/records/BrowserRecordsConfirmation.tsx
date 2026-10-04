import { Button } from '@setsuna-desktop/renderer-ui';
import type { BrowserTranslate } from '../messages.js';

export function BrowserRecordsConfirmation({ title, translate: t, onCancel, onConfirm }: {
  title: string; translate: BrowserTranslate; onCancel(): void; onConfirm(): void;
}) {
  return <div className="browser-records__confirmation" role="group" aria-label={title}>
    <p>{title}</p><div className="browser-records__actions">
      <Button onClick={onCancel}>{t('feature.browser.settings.cancel')}</Button>
      <Button variant="danger" onClick={onConfirm}>{t('feature.browser.records.confirmDelete')}</Button>
    </div>
  </div>;
}
