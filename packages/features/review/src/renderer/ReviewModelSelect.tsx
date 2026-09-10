import type { ComponentType } from 'react';
import type { SettingsSelectFieldProps } from '@setsuna-desktop/renderer-contracts/settings';
import type { ReviewModelOption, ReviewModelSelection } from '../contracts/index.js';
import type { ReviewMessageKey } from './messages.js';

export function ReviewModelSelect({ selection, models, disabled, label, onChange, SelectField, translate: t }: {
  selection: ReviewModelSelection;
  models: readonly ReviewModelOption[];
  disabled?: boolean;
  label: string;
  onChange(selection: ReviewModelSelection): void;
  SelectField: ComponentType<SettingsSelectFieldProps>;
  translate: (key: ReviewMessageKey) => string;
}) {
  const selected = selection ? referenceValue(selection) : '';
  const available = !selected || models.some((model) => referenceValue(model) === selected);
  return (
    <SelectField aria-label={label} disabled={disabled} value={selected} onValueChange={(value) => {
      const model = models.find((option) => referenceValue(option) === value);
      onChange(model ? { providerId: model.providerId, modelId: model.modelId } : null);
    }}>
      <option value="">{t('feature.review.settings.followCurrent')}</option>
      {!available ? <option value={selected} disabled>{t('feature.review.settings.unavailable')}</option> : null}
      {models.map((model) => <option key={referenceValue(model)} value={referenceValue(model)}>{model.providerName} · {model.modelName && model.modelName !== model.modelCode ? `${model.modelName} (${model.modelCode})` : model.modelCode}</option>)}
    </SelectField>
  );
}

function referenceValue(reference: NonNullable<ReviewModelSelection>): string {
  return JSON.stringify([reference.providerId, reference.modelId]);
}
