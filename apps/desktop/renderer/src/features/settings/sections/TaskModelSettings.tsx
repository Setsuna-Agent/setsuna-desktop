import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsModelPicker } from '../../../composition/ModelProviderFeatureBoundary.js';
import { SettingsGroup, SettingsRow, SettingsSection } from '../../../shared/ui/SettingsViewUi.js';
import { configuredTaskModelOptions } from './task-model-options.js';
import type { RuntimePreferenceInput } from '../settings-types.js';

export function TaskModelSettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const options = configuredTaskModelOptions(config);

  return (
    <SettingsSection>
      <SettingsGroup title={t('settings.taskModels.groupContext')}>
        <SettingsRow label={t('settings.taskModels.contextCompaction')}
          description={t('settings.taskModels.contextCompactionDescription')}>
          <SettingsModelPicker
            aria-label={t('settings.taskModels.contextCompaction')}
            models={options}
            value={config.taskModels?.contextCompaction ?? null}
            defaultLabel={t('settings.taskModels.followCurrent')}
            unavailableLabel={t('settings.taskModels.unavailable')}
            onChange={(selection) => { void onSave({ taskModels: { contextCompaction: selection } }); }}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
