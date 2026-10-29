import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { Code2, Sun } from 'lucide-react';
import { TextArea } from '../../../shared/ui/primitives.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsChoiceGroup, type SettingsChoiceOption } from '../components/SettingsControls.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { usePersonalizationPrompt } from './usePersonalizationPrompt.js';
import { useToast } from '../../../app/providers/ToastProvider.js';

const PERSONALIZATION_PROMPT_MAX_LENGTH = 8000;

/** Host-owned personalization that is independent from optional business Features. */
export function PersonalizationSettings({
  config,
  onSavePreferences,
}: Readonly<{
  config: RuntimeConfigState;
  onSavePreferences: (input: RuntimePreferenceInput) => Promise<void>;
}>) {
  const { t } = useI18n();
  const toast = useToast();
  const setsunaStyleOptions: Array<SettingsChoiceOption<RuntimeConfigState['setsunaStyle']>> = [
    { value: 'developer', label: t('settings.personalization.styleDeveloper'), icon: <Code2 size={14} /> },
    { value: 'daily', label: t('settings.personalization.styleDaily'), icon: <Sun size={14} /> },
  ];
  const { draft: globalPromptDraft, change, flush } = usePersonalizationPrompt(config.globalPrompt, onSavePreferences);
  const globalPromptLength = Array.from(globalPromptDraft).length;

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__personalization-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.personalization.style')}</div>
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <span>{t('settings.personalization.setsunaStyle')}</span>
            </span>
            <SettingsChoiceGroup
              ariaLabel={t('settings.personalization.setsunaStyle')}
              options={setsunaStyleOptions}
              value={config.setsunaStyle}
              onChange={(setsunaStyle) => void onSavePreferences({ setsunaStyle }).catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : String(error));
              })}
            />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group chat-user-settings__personalization-card chat-user-settings__personalization-card--prompt">
          <div className="chat-user-settings__prompt-stack">
            <div className="chat-user-settings__prompt-heading">
              <div className="chat-user-settings__prompt-title">
                <span>{t('settings.personalization.prompt')}</span>
              </div>
              <p>{t('settings.personalization.promptDescription')}</p>
            </div>
            <div className="chat-user-settings__prompt-control">
              <div className="chat-user-settings__prompt-input-shell">
                <TextArea
                  className="chat-user-settings__prompt-input"
                  aria-label={t('settings.personalization.prompt')}
                  value={globalPromptDraft}
                  maxLength={PERSONALIZATION_PROMPT_MAX_LENGTH}
                  placeholder={t('settings.personalization.promptPlaceholder')}
                  onBlur={flush}
                  onChange={(event) => change(event.target.value)}
                />
                <span className="chat-user-settings__prompt-count">
                  {globalPromptLength} / {PERSONALIZATION_PROMPT_MAX_LENGTH}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
