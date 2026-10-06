import { useCallback, useState } from 'react';
import { Switch } from '@setsuna-desktop/renderer-ui';
import { Pin, Settings2, Trash2 } from 'lucide-react';
import { BROWSER_WEB_STORE_URL } from '../../contracts/extensions.js';
import { useBrowserExtensions } from '../extensions/useBrowserExtensions.js';
import { useBrowserSettingsNavigation } from './context.js';
import type { BrowserSettingsContentProps } from './types.js';
import { BrowserSettingsSearch } from './BrowserSettingsSearch.js';

export function BrowserExtensionManager({ bridge, translate: t, ui }: BrowserSettingsContentProps) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const notify = useCallback((_tone: unknown, message: string) => setError(message), []);
  const extensions = useBrowserExtensions(bridge, notify, t);
  const navigation = useBrowserSettingsNavigation();
  const items = extensions.extensions.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="browser-settings-collection">
    <BrowserSettingsSearch label={t('feature.browser.settings.search')} value={query} onChange={setQuery} />
    <div className="browser-settings-page__toolbar"><div className="browser-settings-page__actions">
      <ui.Button disabled={!navigation} onClick={() => navigation?.openPage(BROWSER_WEB_STORE_URL)}>{t('feature.browser.extension.store')}</ui.Button>
    </div></div>
    <div className="browser-settings-page__card">{items.length ? <ul className="browser-settings-page__list">{items.map((item) => <li key={item.id}>
      {item.icon ? <img className="browser-settings__extension-icon" src={item.icon} alt="" /> : null}
      <span className="browser-settings__entry">{item.name}</span>
      <ui.IconButton label={t(extensions.pinnedIds.includes(item.id) ? 'feature.browser.extension.unpin' : 'feature.browser.extension.pin')} aria-pressed={extensions.pinnedIds.includes(item.id)} onClick={() => extensions.togglePin(item.id)}><Pin size={14} fill={extensions.pinnedIds.includes(item.id) ? 'currentColor' : 'none'} /></ui.IconButton>
      {item.hasOptions ? <ui.IconButton disabled={extensions.busy || !item.enabled} label={t('feature.browser.extension.options')} onClick={() => void extensions.open(item.id, 'options')}><Settings2 size={14} /></ui.IconButton> : null}
      <ui.IconButton disabled={extensions.busy} label={t('feature.browser.extension.remove')} onClick={() => void extensions.remove(item.id)}><Trash2 size={14} /></ui.IconButton>
      <Switch checked={item.enabled} disabled={extensions.busy}
        label={`${t(item.enabled ? 'feature.browser.extension.disable' : 'feature.browser.extension.enable')} ${item.name}`}
        onCheckedChange={(enabled) => void extensions.setEnabled(item.id, enabled)} />
    </li>)}</ul> : <p className="browser-settings-page__status">{t(extensions.ready ? 'feature.browser.settings.empty' : 'feature.browser.settings.loading')}</p>}</div>
    {error ? <ui.Toast tone="error" message={error} /> : null}
  </div>;
}
