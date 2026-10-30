import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, ConfirmDialogTrigger, Dialog } from '@setsuna-desktop/renderer-ui';
import { Settings } from 'lucide-react';
import { useId, useState } from 'react';
import type { TerminalAction } from '../../contracts/index.js';
import { TerminalActionFields } from './TerminalActionFields.js';
import { TerminalActionPlatformField } from './TerminalActionPlatformField.js';

type TerminalActionDialogProps = {
  translate: RendererTranslate;
  onSave(action: Omit<TerminalAction, 'id'>): boolean;
  onClose(): void;
} & (
  | { mode: 'quick'; onOpenSettings(draft?: TerminalAction): void }
  | { mode: 'settings'; action: TerminalAction; creating: boolean; onRemove?(): boolean }
);

export function TerminalActionDialog(props: TerminalActionDialogProps) {
  const { translate: t, onSave, onClose } = props;
  const [draft, setDraft] = useState<Omit<TerminalAction, 'id'>>(() => props.mode === 'settings'
    ? props.action : { name: '', command: '', icon: 'settings', platform: 'all' });
  const formId = useId();
  const valid = Boolean(draft.name.trim() && draft.command.trim());
  const saveButton = <Button variant="primary" form={formId} type="submit" disabled={!valid}>
    {t('feature.terminal.actions.save')}
  </Button>;
  const footer = props.mode === 'quick' ? <>
    <Button variant="ghost" onClick={() => {
      onClose();
      props.onOpenSettings(draft.name || draft.command || draft.icon !== 'settings'
        ? { ...draft, id: crypto.randomUUID() } : undefined);
    }}>{t('feature.terminal.actions.environmentSettings')}</Button>
    {saveButton}
  </> : <div className="feature-terminal-action-dialog__footer">
    {props.onRemove ? <ConfirmDialogTrigger danger
      title={t('feature.terminal.actions.deleteConfirm', { name: props.action.name })}
      confirmLabel={t('feature.terminal.actions.delete')} cancelLabel={t('feature.terminal.actions.cancel')}
      onConfirm={props.onRemove}>
      <Button variant="danger">{t('feature.terminal.actions.delete')}</Button>
    </ConfirmDialogTrigger> : null}
    <div className="feature-terminal-action-dialog__footer-actions">
      <Button onClick={onClose}>{t('feature.terminal.actions.cancel')}</Button>
      {saveButton}
    </div>
  </div>;

  return <Dialog width={480} className="feature-terminal-action-dialog"
    title={<><span className="feature-terminal-action-dialog__badge"><Settings size={18} aria-hidden="true" /></span>
      {t(props.mode === 'settings' && !props.creating ? 'feature.terminal.actions.edit' : 'feature.terminal.actions.add')}</>}
    onClose={onClose} footer={footer}
  >
    <form id={formId} className="feature-terminal-action-dialog__form" onSubmit={(event) => {
      event.preventDefault();
      if (valid && onSave(draft)) onClose();
    }}>
      <TerminalActionFields value={draft} onChange={setDraft} translate={t} compact={props.mode === 'settings'} autoFocus />
      {props.mode === 'settings' ? <TerminalActionPlatformField value={draft.platform} translate={t}
        onChange={(platform) => setDraft((current) => ({ ...current, platform }))} /> : null}
    </form>
  </Dialog>;
}
