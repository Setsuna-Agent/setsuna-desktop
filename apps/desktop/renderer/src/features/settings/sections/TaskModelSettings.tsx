import type {
  RuntimeConfigState,
  RuntimeTaskModelId,
} from '@setsuna-desktop/contracts';
import { Combine, Minimize2, SearchCheck, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';
import { SelectField } from '../../../shared/ui/primitives.js';
import {
  configuredTaskModelOptions,
  configuredTaskModelReferenceValue,
} from '../providers/provider-model.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { TaskModelOptionLabel } from './TaskModelOptionLabel.js';

const taskModelFields: Array<{
  descriptionKey: MessageKey;
  icon: LucideIcon;
  id: RuntimeTaskModelId;
  labelKey: MessageKey;
}> = [
  {
    id: 'memoryExtraction',
    labelKey: 'settings.taskModels.memoryExtraction',
    descriptionKey: 'settings.taskModels.memoryExtractionDescription',
    icon: SearchCheck,
  },
  {
    id: 'memoryConsolidation',
    labelKey: 'settings.taskModels.memoryConsolidation',
    descriptionKey: 'settings.taskModels.memoryConsolidationDescription',
    icon: Combine,
  },
  {
    id: 'contextCompaction',
    labelKey: 'settings.taskModels.contextCompaction',
    descriptionKey: 'settings.taskModels.contextCompactionDescription',
    icon: Minimize2,
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
        <div className="chat-user-settings__group-title">{t('settings.taskModels.assignment')}</div>
        <p className="task-model-settings__intro">{t('settings.taskModels.assignmentDescription')}</p>
        <div className="chat-user-settings__group task-model-settings__card">
          {taskModelFields.map((field) => {
            const Icon = field.icon;
            const selectedValue = configuredTaskModelReferenceValue(config.taskModels?.[field.id]);
            const selectionAvailable = !selectedValue || options.some((option) => option.value === selectedValue);
            return (
              <div className="chat-user-settings__row task-model-settings__row" key={field.id}>
                <span className="chat-user-settings__row-label task-model-settings__label">
                  <Icon size={14} />
                  <span className="task-model-settings__copy">
                    <span>{t(field.labelKey)}</span>
                    <small>{t(field.descriptionKey)}</small>
                  </span>
                </span>
                <SelectField
                  aria-label={t(field.labelKey)}
                  className="settings-local-control task-model-settings__select"
                  value={selectedValue}
                  onValueChange={(nextValue) => {
                    const selection = options.find((option) => option.value === nextValue)?.reference ?? null;
                    void onSave({ taskModels: { [field.id]: selection } });
                  }}
                >
                  <option value="">
                    <TaskModelOptionLabel
                      label={t('settings.taskModels.followCurrent')}
                      variant="follow-current"
                    />
                  </option>
                  {!selectionAvailable ? (
                    <option value={selectedValue} disabled>
                      <TaskModelOptionLabel
                        label={t('settings.taskModels.unavailable')}
                        variant="unavailable"
                      />
                    </option>
                  ) : null}
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      <TaskModelOptionLabel
                        label={option.label}
                        model={option.model}
                        provider={option.provider}
                      />
                    </option>
                  ))}
                </SelectField>
              </div>
            );
          })}
        </div>
        <p className="task-model-settings__hint">
          {options.length
            ? t('settings.taskModels.availableHint')
            : t('settings.taskModels.emptyHint')}
        </p>
      </div>
    </div>
  );
}
