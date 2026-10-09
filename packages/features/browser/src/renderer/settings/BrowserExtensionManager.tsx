import { useCallback, useState } from 'react';
import { BROWSER_WEB_STORE_URL } from '../../contracts/extensions.js';
import { useBrowserExtensions } from '../extensions/useBrowserExtensions.js';
import { useBrowserSettingsNavigation } from './context.js';
import type { BrowserSettingsContentProps } from './types.js';
import { BrowserSettingsSearch } from './BrowserSettingsSearch.js';
import { BrowserExtensionControls } from './BrowserExtensionControls.js';
import { BrowserExtensionDetails } from './BrowserExtensionDetails.js';
import './extension-details.css';

export function BrowserExtensionManager({ bridge, translate: t, ui }: BrowserSettingsContentProps) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const notify = useCallback((_tone: unknown, message: string) => setError(message), []);
  const extensions = useBrowserExtensions(bridge, notify, t);
  const navigation = useBrowserSettingsNavigation();
  const items = extensions.extensions.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = extensions.extensions.find((item) => item.id === selectedId);
  return <div className="browser-settings-collection">
    {!selected ? <BrowserSettingsSearch label={t('feature.browser.settings.search')} value={query} onChange={setQuery} /> : null}
    <div className="browser-settings-page__toolbar"><div className="browser-settings-page__actions">
      <ui.Button disabled={extensions.busy || !extensions.canInstall} onClick={() => void extensions.install()}>{t('feature.browser.extension.installUnpacked')}</ui.Button>
      <ui.Button disabled={!navigation} onClick={() => navigation?.openPage(BROWSER_WEB_STORE_URL)}>{t('feature.browser.extension.store')}</ui.Button>
    </div></div>
    {selected ? <BrowserExtensionDetails item={selected} controller={extensions} onBack={() => setSelectedId(null)} ui={ui} translate={t} />
      : <div className="browser-settings-page__card">{items.length ? <ul className="browser-settings-page__list">{items.map((item) => <li key={item.id}>
      {item.icon ? <img className="browser-settings__extension-icon" src={item.icon} alt="" /> : null}
      <button type="button" className="browser-settings__entry browser-extension-details__open" onClick={() => setSelectedId(item.id)}>{item.name}</button>
      <BrowserExtensionControls item={item} controller={extensions} ui={ui} translate={t} />
    </li>)}</ul> : <p className="browser-settings-page__status">{t(extensions.ready ? 'feature.browser.settings.empty' : 'feature.browser.settings.loading')}</p>}</div>}
    {error ? <ui.Toast tone="error" message={error} /> : null}
  </div>;
}
