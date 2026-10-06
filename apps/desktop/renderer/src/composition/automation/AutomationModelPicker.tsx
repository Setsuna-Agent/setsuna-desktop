import type { AutomationModelPickerProps } from '@setsuna-desktop/feature-automation/renderer';
import { useModelProviderSnapshot } from '@setsuna-desktop/feature-model-provider/renderer';
import { useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ConfiguredModelPicker } from '../../shared/ui/model-picker/ConfiguredModelPicker.js';
import { modelOptionKey, modelOptions } from '../../shared/ui/model-picker/modelOptions.js';

export function AutomationModelPicker({ models, value, disabled, translate, onChange }: AutomationModelPickerProps) {
  const { state } = useModelProviderSnapshot();
  const { t } = useI18n();
  const options = useMemo(() => {
    const available = new Set(models.map((model) => modelOptionKey(model.providerId, model.modelId)));
    // The runtime owns availability; the existing provider projection supplies branding and details.
    return modelOptions(state).filter((option) => available.has(option.key));
  }, [models, state]);
  return (
    <ConfiguredModelPicker aria-label={translate('feature.automation.model')}
      options={options} disabled={disabled || !state} value={value ?? null}
      defaultLabel={translate('feature.automation.defaultModel')} unavailableLabel={t('settings.taskModels.unavailable')}
      onChange={(selection) => onChange(selection ?? undefined)} />
  );
}
