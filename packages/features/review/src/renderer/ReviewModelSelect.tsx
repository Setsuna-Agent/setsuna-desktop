import type { ComponentType } from 'react';
import type { SettingsModelPickerProps } from '@setsuna-desktop/renderer-contracts/settings';
import type { ReviewModelOption, ReviewModelSelection } from '../contracts/index.js';
import type { ReviewMessageKey } from './messages.js';

export function ReviewModelSelect({ selection, models, disabled, label, onChange, ModelPicker, translate: t }: {
  selection: ReviewModelSelection;
  models: readonly ReviewModelOption[];
  disabled?: boolean;
  label: string;
  onChange(selection: ReviewModelSelection): void;
  ModelPicker: ComponentType<SettingsModelPickerProps>;
  translate: (key: ReviewMessageKey) => string;
}) {
  return (
    <ModelPicker aria-label={label} disabled={disabled} models={models} value={selection} onChange={onChange}
      defaultLabel={t('feature.review.settings.followCurrent')} unavailableLabel={t('feature.review.settings.unavailable')} />
  );
}
