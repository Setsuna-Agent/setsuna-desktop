import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { CollaborationAgentRole, CollaborationModelOption } from '../contracts/index.js';

export function CollaborationReasoningSelect({ ui, translate: t, models, model, label, value, disabled, onChange }: Readonly<{
  ui: SettingsViewUi;
  translate: RendererTranslate;
  models: readonly CollaborationModelOption[];
  model: CollaborationAgentRole['model'];
  label: string;
  value: string | null;
  disabled: boolean;
  onChange(value: string | null): void;
}>) {
  const configured = models.find((entry) => entry.providerId === model?.providerId && entry.modelId === model.modelId);
  const efforts = new Set(configured?.reasoningEfforts ?? models.flatMap((entry) => entry.reasoningEfforts));
  if (value && value !== 'none') efforts.add(value);
  return (
    <ui.SelectField aria-label={label} value={value ?? ''} disabled={disabled} onValueChange={(value) => onChange(value || null)}>
      <option value="">{t('feature.collaboration.settings.inherit')}</option>
      <option value="none">{t('feature.collaboration.settings.noThinking')}</option>
      {[...efforts].filter((effort) => effort !== 'none').map((effort) => <option key={effort} value={effort}>{effort}</option>)}
    </ui.SelectField>
  );
}
