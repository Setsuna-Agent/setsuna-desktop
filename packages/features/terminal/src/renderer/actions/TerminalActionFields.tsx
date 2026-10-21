import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { TextArea, TextField } from '@setsuna-desktop/renderer-ui';
import { useEffect, useId, useRef } from 'react';
import { TERMINAL_ACTION_COMMAND_MAX_LENGTH, TERMINAL_ACTION_NAME_MAX_LENGTH, type TerminalAction } from '../../contracts/index.js';
import { TerminalActionIconPicker } from './TerminalActionIcon.js';

type ActionFields = Omit<TerminalAction, 'id'>;

export function TerminalActionFields({ value, onChange, translate: t, autoFocus = false, compact = false }: {
  value: ActionFields;
  onChange(value: ActionFields): void;
  translate: RendererTranslate;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const nameId = useId();
  const commandId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) input.current?.focus({ preventScroll: true }); }, [autoFocus]);

  return <div className="feature-terminal-action__fields">
    <label htmlFor={nameId}>{t('feature.terminal.actions.name')}</label>
    <div className="feature-terminal-action__name">
      <TerminalActionIconPicker value={value.icon} translate={t} onChange={(icon) => onChange({ ...value, icon })} />
      <TextField id={nameId} ref={input} value={value.name} required maxLength={TERMINAL_ACTION_NAME_MAX_LENGTH}
        onChange={(event) => onChange({ ...value, name: event.target.value })} onKeyDown={(event) => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
        }} />
    </div>
    <label htmlFor={commandId}>{t(compact ? 'feature.terminal.actions.script' : 'feature.terminal.actions.command')}</label>
    <TextArea id={commandId} value={value.command} required rows={compact ? 4 : 7} spellCheck={false}
      placeholder={t('feature.terminal.actions.commandPlaceholder')} maxLength={TERMINAL_ACTION_COMMAND_MAX_LENGTH}
      onChange={(event) => onChange({ ...value, command: event.target.value })} />
  </div>;
}
