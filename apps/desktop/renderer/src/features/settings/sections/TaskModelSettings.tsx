import type {
  RuntimeConfigState,
  RuntimeTaskModelId,
} from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';
import { SettingsModelPicker } from '../../../composition/ModelProviderFeatureBoundary.js';
import { SettingsRow } from '../../../shared/ui/SettingsViewUi.js';
import { configuredTaskModelOptions } from './task-model-options.js';
import type { RuntimePreferenceInput } from '../settings-types.js';

type TaskModelField = {
  descriptionKey: MessageKey;
  id: RuntimeTaskModelId;
  labelKey: MessageKey;
};

const taskModelGroups: Array<{
  fields: TaskModelField[];
  id: string;
  labelKey: MessageKey;
}> = [
  {
    id: 'context',
    labelKey: 'settings.taskModels.groupContext',
    fields: [
      {
        id: 'contextCompaction',
        labelKey: 'settings.taskModels.contextCompaction',
        descriptionKey: 'settings.taskModels.contextCompactionDescription',
      },
    ],
  },
];

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
    <div className="chat-user-settings__section chat-user-settings__section--stacked task-model-settings">
      <div className="chat-user-settings__section-block">
        <div className="task-model-settings__groups">
          {taskModelGroups.map((group) => (
            <section
              aria-labelledby={`task-model-group-${group.id}`}
              className="task-model-settings__group"
              key={group.id}
            >
              <h3
                className="chat-user-settings__group-title task-model-settings__group-title"
                id={`task-model-group-${group.id}`}
              >
                {t(group.labelKey)}
              </h3>
              <div className="chat-user-settings__group task-model-settings__card">
                {group.fields.map((field) => (
                  <SettingsRow
                    key={field.id}
                    label={t(field.labelKey)}
                    description={t(field.descriptionKey)}
                  >
                    <SettingsModelPicker
                      aria-label={t(field.labelKey)}
                      models={options}
                      value={config.taskModels?.[field.id] ?? null}
                      defaultLabel={t('settings.taskModels.followCurrent')}
                      unavailableLabel={t('settings.taskModels.unavailable')}
                      onChange={(selection) => {
                        void onSave({ taskModels: { [field.id]: selection } });
                      }}
                    />
                  </SettingsRow>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
