import { Flag, Play } from 'lucide-react';
import { useState } from 'react';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignInteraction } from '../../contracts/index.js';
import { InspectorSection } from '../inspector/DesignInspectorFields.js';

export type PrototypeFields = Readonly<{
  interaction?: DesignInteraction;
  targets: readonly { id: string; name: string }[];
  start?: Readonly<{ selected: boolean; toggle(): void }>;
  onPlayBoard?(): void;
  onChange(interaction: DesignInteraction | undefined): void;
}>;

export function DesignPrototypeFields({ interaction, targets, start, onPlayBoard, disabled, onChange, translate: t }:
  PrototypeFields & Readonly<{ disabled: boolean; translate: RendererTranslate }>) {
  const [draftAction, setDraftAction] = useState<'navigate' | 'overlay'>();
  const action = draftAction ?? interaction?.kind ?? '';
  const currentTarget = !draftAction && interaction && 'targetId' in interaction ? interaction.targetId : '';
  const titleActions = onPlayBoard || start ? <div className="design-prototype-field-actions">
    {start ? <IconButton size="small" disabled={disabled}
      label={t(start.selected ? 'feature.design.prototype.clearStart' : 'feature.design.prototype.setStart')}
      aria-pressed={start.selected} onClick={start.toggle}><Flag size={14} /></IconButton> : null}
    {onPlayBoard ? <IconButton size="small" disabled={disabled} label={t('feature.design.prototype.playFromBoard')}
      onClick={onPlayBoard}><Play size={14} /></IconButton> : null}
  </div> : null;
  return <InspectorSection title={t('feature.design.prototype')} action={titleActions}>
    <SelectField aria-label={t('feature.design.prototype.action')} value={action} disabled={disabled} onValueChange={(kind) => {
      if (kind === 'navigate' || kind === 'overlay') {
        setDraftAction(kind);
      } else {
        setDraftAction(undefined);
        onChange(kind === 'back' || kind === 'close' ? { kind } : undefined);
      }
    }}>
      <option value="">{t('feature.design.prototype.none')}</option>
      <option value="navigate" disabled={!targets.length}>{t('feature.design.prototype.navigate')}</option>
      <option value="overlay" disabled={!targets.length}>{t('feature.design.prototype.overlay')}</option>
      <option value="back">{t('feature.design.prototype.back')}</option>
      <option value="close">{t('feature.design.prototype.close')}</option>
    </SelectField>
    {action === 'navigate' || action === 'overlay' ? <SelectField aria-label={t('feature.design.prototype.target')}
      value={targets.some(({ id }) => id === currentTarget) ? currentTarget : ''} disabled={disabled}
      onValueChange={(targetId) => {
        if (!targetId) return;
        setDraftAction(undefined);
        onChange({ kind: action, targetId });
      }}>
      <option value="" disabled>{t('feature.design.prototype.target')}</option>
      {targets.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
    </SelectField> : null}
  </InspectorSection>;
}
