import { SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignInteraction } from '../../contracts/index.js';
import { InspectorSection } from '../inspector/DesignInspectorFields.js';

export type PrototypeFields = Readonly<{
  interaction?: DesignInteraction;
  targets: readonly { id: string; name: string }[];
  onChange(interaction: DesignInteraction | undefined): void;
}>;

export function DesignPrototypeFields({ interaction, targets, disabled, onChange, translate: t }:
  PrototypeFields & Readonly<{ disabled: boolean; translate: RendererTranslate }>) {
  const action = t('feature.design.prototype.action');
  return <InspectorSection title={t('feature.design.prototype')}>
    <SelectField aria-label={action} value={interaction?.kind ?? ''} disabled={disabled} onValueChange={(kind) => {
      if (kind === 'back' || kind === 'close') onChange({ kind });
      else if (kind === 'navigate' || kind === 'overlay') {
        const targetId = interaction && 'targetId' in interaction ? interaction.targetId : targets[0]?.id;
        if (targetId) onChange({ kind, targetId });
      } else onChange(undefined);
    }}>
      <option value="">{t('feature.design.prototype.none')}</option>
      <option value="navigate" disabled={!targets.length}>{t('feature.design.prototype.navigate')}</option>
      <option value="overlay" disabled={!targets.length}>{t('feature.design.prototype.overlay')}</option>
      <option value="back">{t('feature.design.prototype.back')}</option>
      <option value="close">{t('feature.design.prototype.close')}</option>
    </SelectField>
    {interaction && 'targetId' in interaction ? <SelectField aria-label={t('feature.design.prototype.target')}
      value={targets.some(({ id }) => id === interaction.targetId) ? interaction.targetId : ''} disabled={disabled}
      onValueChange={(targetId) => { if (targetId) onChange({ kind: interaction.kind, targetId }); }}>
      <option value="" disabled>{t('feature.design.prototype.target')}</option>
      {targets.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
    </SelectField> : null}
  </InspectorSection>;
}
