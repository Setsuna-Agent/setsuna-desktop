import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { Globe2 } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsGroup, SettingsRow } from '../../../shared/ui/SettingsViewUi.js';
import { SelectField } from '../../../shared/ui/primitives.js';
import { markdownLinkOpenModeFromConfig } from '../../chat/markdown/markdownLinkPreference.js';
import type { RuntimePreferenceInput } from '../settings-types.js';

/** Link routing remains an app preference even though it is configured under Browser. */
export function BrowserLinkSettings({ config, onSave }: {
  config: RuntimeConfigState | null;
  onSave(input: RuntimePreferenceInput): Promise<void>;
}) {
  const { t } = useI18n();
  const setOpenMode = (nextValue: string) => {
    if (!config || (nextValue !== 'in-app' && nextValue !== 'external')) return;
    void onSave({ desktopSettings: { ...config.desktopSettings, markdownLinkOpenMode: nextValue } });
  };
  return (
    <SettingsGroup title={t('settings.general.links')}>
      <SettingsRow icon={<Globe2 size={14} />} label={t('settings.general.markdownLinks')}>
        <SelectField
          className="sd-settings-select--compact"
          aria-label={t('settings.general.markdownLinksMode')}
          disabled={!config}
          value={markdownLinkOpenModeFromConfig(config)}
          onValueChange={setOpenMode}
        >
          <option value="in-app">{t('settings.general.openInApp')}</option>
          <option value="external">{t('settings.general.openExternal')}</option>
        </SelectField>
      </SettingsRow>
    </SettingsGroup>
  );
}
