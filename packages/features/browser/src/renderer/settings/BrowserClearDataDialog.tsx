import { useState } from 'react';
import type { BrowserClearData } from '../../contracts/settings.js';
import { writeBrowserHistory } from '../browserHistory.js';
import type { BrowserSettingsDialogProps } from './types.js';
import { useBrowserSettingsAction } from './useBrowserPreferences.js';

export function BrowserClearDataDialog({ bridge, translate: t, ui, onClose }: BrowserSettingsDialogProps) {
  const [selection, setSelection] = useState<BrowserClearData & { history: boolean }>({ history: true, cache: true });
  const { busy, error, run } = useBrowserSettingsAction();
  const clear = async () => {
    const { history, ...native } = selection;
    if (await run(async () => { await bridge.clearBrowserData(native); if (history) writeBrowserHistory([]); })) onClose();
  };
  return <ui.Dialog title={t('feature.browser.settings.clearData')} closeLabel={t('feature.browser.settings.close')} onClose={() => { if (!busy) onClose(); }} footer={<>
    <ui.Button disabled={busy} onClick={onClose}>{t('feature.browser.settings.cancel')}</ui.Button>
    <ui.Button variant="danger" disabled={busy || !Object.values(selection).some(Boolean)} onClick={() => void clear()}>{t('feature.browser.settings.clear')}</ui.Button>
  </>}>
    <div className="browser-settings__form">{(['history', 'cookies', 'cache', 'siteStorage', 'passwords'] as const).map((key) =>
      <ui.Checkbox key={key} checked={Boolean(selection[key])} disabled={busy} onChange={(checked) => setSelection({ ...selection, [key]: checked })}>{t(`feature.browser.settings.${key}`)}</ui.Checkbox>)}</div>
    {error ? <ui.Toast tone="error" message={t('feature.browser.settings.failed')} /> : null}
  </ui.Dialog>;
}
