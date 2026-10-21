import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { Trash2 } from 'lucide-react';
import { useId } from 'react';
import { TERMINAL_ACTION_PLATFORMS, type TerminalAction } from '../../contracts/index.js';
import { TerminalActionFields } from './TerminalActionFields.js';

export function TerminalActionCard({ action, translate: t, autoFocus, onChange, onRemove }: {
  action: TerminalAction;
  translate: RendererTranslate;
  autoFocus: boolean;
  onChange(action: TerminalAction): void;
  onRemove(): void;
}) {
  const platformGroup = useId();
  return <div className="feature-terminal-action-card">
    <TerminalActionFields value={action} compact autoFocus={autoFocus} translate={t}
      onChange={(fields) => onChange({ ...fields, id: action.id })} />
    <div className="feature-terminal-action-card__footer">
      <fieldset className="feature-terminal-action-platform">
        <legend>{t('feature.terminal.actions.platform')}</legend>
        {TERMINAL_ACTION_PLATFORMS.map((platform) => <label key={platform}>
          <input className="sd-visually-hidden" type="radio" name={platformGroup} value={platform} checked={action.platform === platform}
            onChange={() => onChange({ ...action, platform })} />
          <span>{t(`feature.terminal.actions.platform.${platform}`)}</span>
        </label>)}
      </fieldset>
      <IconButton label={t('feature.terminal.actions.delete')} onClick={onRemove}><Trash2 size={15} /></IconButton>
    </div>
  </div>;
}
