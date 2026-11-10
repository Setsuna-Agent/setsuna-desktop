import { useModelProviderSnapshot } from '@setsuna-desktop/feature-model-provider/renderer';
import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ConfiguredModelPicker } from '../../shared/ui/model-picker/ConfiguredModelPicker.js';
import { modelOptionKey, modelOptions } from '../../shared/ui/model-picker/modelOptions.js';

export type FeatureModelPickerProps = Readonly<{
  /** Models the feature's runtime accepts; the provider projection only supplies branding and details. */
  models: readonly { providerId: string; modelId: string }[];
  value?: RuntimeConfiguredModelReference;
  disabled?: boolean;
  label: string;
  defaultLabel: string;
  onChange(value: RuntimeConfiguredModelReference | undefined): void;
}>;

export function FeatureModelPicker({ models, value, disabled, label, defaultLabel, onChange }: FeatureModelPickerProps) {
  const { confirmedState: state } = useModelProviderSnapshot();
  const { t } = useI18n();
  const options = useMemo(() => {
    const available = new Set(models.map((model) => modelOptionKey(model.providerId, model.modelId)));
    return modelOptions(state).filter((option) => available.has(option.key));
  }, [models, state]);
  return (
    <ConfiguredModelPicker aria-label={label}
      options={options} disabled={disabled || !state} value={value ?? null}
      defaultLabel={defaultLabel} unavailableLabel={t('settings.taskModels.unavailable')}
      onChange={(selection) => onChange(selection ?? undefined)} />
  );
}
