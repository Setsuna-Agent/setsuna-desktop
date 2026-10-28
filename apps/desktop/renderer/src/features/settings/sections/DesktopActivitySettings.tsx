import { DEFAULT_DESKTOP_ACTIVITY_PREFERENCES, DESKTOP_SUMMON_SHORTCUTS, type DesktopActivityPreferences } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsGroup, SettingsRow, SettingsToggle } from '../../../shared/ui/SettingsViewUi.js';
import { SelectField } from '../../../shared/ui/primitives.js';

export function DesktopActivitySettings() {
  const { t } = useI18n();
  const toast = useToast();
  const [value, setValue] = useState(DEFAULT_DESKTOP_ACTIVITY_PREFERENCES);
  const [busy, setBusy] = useState(true);
  const api = window.setsunaDesktop?.windowControls;
  useEffect(() => {
    if (!api?.getActivityPreferences) return;
    let disposed = false;
    void api.getActivityPreferences().then((value) => { if (!disposed) { setValue(value); setBusy(false); } }, (error: unknown) => {
      if (!disposed) toast.error(error instanceof Error ? error.message : String(error));
    });
    return () => { disposed = true; };
  }, [api, toast]);
  const save = async (next: DesktopActivityPreferences) => {
    if (!api || busy) return;
    setBusy(true);
    try { setValue(await api.setActivityPreferences(next)); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!api?.getActivityPreferences) return null;
  return <SettingsGroup title={t('settings.desktop.behavior')}>
    <SettingsToggle description={null} label={t('settings.desktop.keepAwake')} checked={value.keepAwakeDuringTasks} disabled={busy}
      onChange={(keepAwakeDuringTasks) => void save({ ...value, keepAwakeDuringTasks })} />
    <SettingsRow label={t('settings.desktop.summon')}>
      <SelectField aria-label={t('settings.desktop.summon')} value={value.summonShortcut} disabled={busy}
        onValueChange={(shortcut) => void save({ ...value, summonShortcut: shortcut as DesktopActivityPreferences['summonShortcut'] })}>
        {DESKTOP_SUMMON_SHORTCUTS.map((shortcut) => <option key={shortcut} value={shortcut}>{shortcut === 'disabled' ? t('settings.desktop.disabled') : shortcut.replace('CommandOrControl', window.setsunaDesktop?.desktop.platform === 'darwin' ? '⌘' : 'Ctrl').replace('Shift', '⇧').replace('Alt', '⌥')}</option>)}
      </SelectField>
    </SettingsRow>
  </SettingsGroup>;
}
