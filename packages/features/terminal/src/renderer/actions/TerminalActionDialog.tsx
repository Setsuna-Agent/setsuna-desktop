import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog } from '@setsuna-desktop/renderer-ui';
import { Settings } from 'lucide-react';
import { useId, useState } from 'react';
import type { TerminalAction, TerminalActionInput } from '../../contracts/index.js';
import { TerminalActionFields } from './TerminalActionFields.js';

export function TerminalActionDialog({ translate: t, onSave, onOpenSettings, onClose }: {
  translate: RendererTranslate;
  onSave(action: TerminalActionInput): boolean;
  onOpenSettings(draft?: TerminalAction): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<Omit<TerminalAction, 'id'>>({ name: '', command: '', icon: 'settings', platform: 'all' });
  const formId = useId();

  return <Dialog width={380} className="feature-terminal-action-dialog"
    title={<><span className="feature-terminal-action-dialog__badge"><Settings size={18} aria-hidden="true" /></span>
      {t('feature.terminal.actions.add')}</>}
    onClose={onClose} footer={<>
      <Button variant="ghost" onClick={() => {
        onClose();
        onOpenSettings(draft.name || draft.command || draft.icon !== 'settings'
          ? { ...draft, id: crypto.randomUUID() } : undefined);
      }}>{t('feature.terminal.actions.environmentSettings')}</Button>
      <Button variant="primary" form={formId} type="submit" disabled={!draft.name.trim() || !draft.command.trim()}>
        {t('feature.terminal.actions.save')}
      </Button>
    </>}
  >
    <form id={formId} onSubmit={(event) => {
      event.preventDefault();
      if (onSave(draft)) onClose();
    }}>
      <TerminalActionFields value={draft} onChange={setDraft} translate={t} autoFocus />
    </form>
  </Dialog>;
}
