import { useId } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog, TextField } from '@setsuna-desktop/renderer-ui';
import { ASSISTANT_SIDEBAR_TITLE_LIMIT } from '../contracts/index.js';

export function AssistantEntryRenameDialog({ title, busy, translate: t, onChange, onSave, onClose }: {
  title: string; busy: boolean; translate: RendererTranslate;
  onChange(title: string): void; onSave(): void; onClose(): void;
}) {
  const formId = useId();
  return <Dialog title={t('feature.assistants.sidebar.rename')} width={400} onClose={onClose} dismissible={!busy}
    footer={<>
      <Button disabled={busy} onClick={onClose}>{t('feature.assistants.cancel')}</Button>
      <Button variant="primary" type="submit" form={formId} disabled={!title.trim()} loading={busy}>{t('feature.assistants.save')}</Button>
    </>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <TextField autoFocus required disabled={busy} maxLength={ASSISTANT_SIDEBAR_TITLE_LIMIT}
        aria-label={t('feature.assistants.name')} value={title} onChange={(event) => onChange(event.target.value)} />
    </form>
  </Dialog>;
}
