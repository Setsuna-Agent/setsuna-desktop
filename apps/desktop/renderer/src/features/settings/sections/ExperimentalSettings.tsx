import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { Dialog, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsGroup, SettingsToggle } from '../../../shared/ui/SettingsViewUi.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { errorMessage } from '../settings-utils.js';

const BACKGROUND_COMPACTION_DETAILS = ['trigger', 'apply', 'cost', 'disabled'] as const;

export function ExperimentalSettings({ config, onSave }: {
  config: RuntimeConfigState;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const saveBackgroundCompaction = async (enabled: boolean) => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ features: { ...config.features, backgroundContextCompaction: enabled } });
    } catch (error) {
      setSaveError(errorMessage(error, t('settings.runtime.saveError', {
        label: t('settings.experimental.backgroundCompaction'),
      })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked">
      <SettingsGroup>
        <SettingsToggle
          label={t('settings.experimental.backgroundCompaction')}
          description={(
            <>
              {t('settings.experimental.backgroundCompactionDescription')}
              <button
                type="button"
                className="experimental-settings__details-link"
                aria-haspopup="dialog"
                onClick={() => setDetailsOpen(true)}
              >
                {t('settings.experimental.viewDetails')}
              </button>
            </>
          )}
          checked={config.features?.backgroundContextCompaction === true}
          disabled={saving}
          onChange={(enabled) => void saveBackgroundCompaction(enabled)}
        />
      </SettingsGroup>
      {detailsOpen ? (
        <Dialog
          title={t('settings.experimental.backgroundCompaction')}
          closeLabel={t('common.close')}
          onClose={() => setDetailsOpen(false)}
        >
          <dl className="experimental-settings__details">
            {BACKGROUND_COMPACTION_DETAILS.map((detail) => (
              <div key={detail}>
                <dt>{t(`settings.experimental.backgroundCompaction.${detail}.title`)}</dt>
                <dd>{t(`settings.experimental.backgroundCompaction.${detail}.description`)}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      ) : null}
      {saveError ? <ToastNotice message={saveError} /> : null}
    </div>
  );
}
