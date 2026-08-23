import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { Code2, Palette, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TextArea } from '../../../shared/ui/primitives.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsChoiceGroup, type SettingsChoiceOption } from '../components/SettingsControls.js';
import type { RuntimePreferenceInput } from '../settings-types.js';

const PERSONALIZATION_PROMPT_MAX_LENGTH = 8000;
const PERSONALIZATION_PROMPT_SAVE_DELAY_MS = 360;

/** Host-owned personalization that is independent from optional business Features. */
export function PersonalizationSettings({
  config,
  onSavePreferences,
}: Readonly<{
  config: RuntimeConfigState;
  onSavePreferences: (input: RuntimePreferenceInput) => Promise<void>;
}>) {
  const { t } = useI18n();
  const setsunaStyleOptions: Array<SettingsChoiceOption<RuntimeConfigState['setsunaStyle']>> = [
    { value: 'developer', label: t('settings.personalization.styleDeveloper'), icon: <Code2 size={14} /> },
    { value: 'daily', label: t('settings.personalization.styleDaily'), icon: <Sun size={14} /> },
  ];
  const [globalPromptDraft, setGlobalPromptDraft] = useState(config.globalPrompt);
  const globalPromptLength = Array.from(globalPromptDraft).length;

  useEffect(() => {
    setGlobalPromptDraft(config.globalPrompt);
  }, [config.globalPrompt]);

  useEffect(() => {
    if (globalPromptDraft === config.globalPrompt) return undefined;
    const timer = window.setTimeout(() => {
      void onSavePreferences({ globalPrompt: globalPromptDraft });
    }, PERSONALIZATION_PROMPT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [config.globalPrompt, globalPromptDraft, onSavePreferences]);

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__personalization-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.personalization.style')}</div>
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>{t('settings.personalization.setsunaStyle')}</span>
            </span>
            <SettingsChoiceGroup
              ariaLabel={t('settings.personalization.setsunaStyle')}
              options={setsunaStyleOptions}
              value={config.setsunaStyle}
              onChange={(setsunaStyle) => void onSavePreferences({ setsunaStyle })}
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
                  value={globalPromptDraft}
                  maxLength={PERSONALIZATION_PROMPT_MAX_LENGTH}
                  placeholder={t('settings.personalization.promptPlaceholder')}
                  onBlur={() => {
                    if (globalPromptDraft !== config.globalPrompt) {
                      void onSavePreferences({ globalPrompt: globalPromptDraft });
                    }
                  }}
                  onChange={(event) => setGlobalPromptDraft(event.target.value)}
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
