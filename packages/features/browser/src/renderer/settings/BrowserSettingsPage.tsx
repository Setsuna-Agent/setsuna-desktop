import { useEffect, useState, type ReactNode } from 'react';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { BROWSER_PERMISSIONS, type BrowserPreferences, type BrowserSearchEngine, type BrowserPermissionPolicy } from '../../contracts/settings.js';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';
import type { BrowserTranslate } from '../messages.js';
import { BrowserFeatureIcon } from '../BrowserFeatureIcon.js';
import { BrowserFavoritesIcon, BrowserHistoryIcon } from '../records/recordIcons.js';
import { BrowserClearDataDialog } from './BrowserClearDataDialog.js';
import { BrowserSettingsDetail, type BrowserSettingsDetailKind } from './BrowserSettingsDetail.js';
import { useBrowserSettingsNavigation } from './context.js';
import { useBrowserPreferences } from './useBrowserPreferences.js';
import './settings.css';
import './settings-pages.css';

type Manager = BrowserSettingsDetailKind | 'clear';
type ToggleSetting = { [K in keyof BrowserPreferences]: BrowserPreferences[K] extends boolean ? K : never }[keyof BrowserPreferences];

export function BrowserSettingsPage({ bridge, children, translate: t, ui }: { bridge: BrowserDesktopBridge | null; children?: ReactNode; translate: BrowserTranslate; ui: SettingsViewUi }) {
  const { preferences, ready, busy, error, run, update } = useBrowserPreferences(bridge);
  const navigation = useBrowserSettingsNavigation();
  const [manager, setManager] = useState<Manager | null>(null);
  const extensionsRequested = navigation?.extensionsRequested;
  const consumeExtensionsRequest = navigation?.consumeExtensionsRequest;
  useEffect(() => {
    // The host selects the browser section; its nested management route stays Feature-owned.
    if (extensionsRequested) { setManager('extensions'); consumeExtensionsRequest?.(); }
  }, [extensionsRequested, consumeExtensionsRequest]);
  const [home, setHome] = useState('');
  useEffect(() => { setHome(preferences.homeUrl); }, [preferences.homeUrl]);
  if (!bridge?.getBrowserPreferences) return <ui.EmptyState title={t('feature.browser.settings.unavailable')} />;
  if (!ready) return <ui.EmptyState title={t(error ? 'feature.browser.settings.failed' : 'feature.browser.settings.loading')} />;
  if (manager && manager !== 'clear') return <BrowserSettingsDetail kind={manager} bridge={bridge} translate={t} ui={ui} onBack={() => setManager(null)} />;
  const toggle = (key: ToggleSetting) => <ui.Toggle key={key} label={t(`feature.browser.settings.${key}`)} description={null} checked={preferences[key]} disabled={busy} onChange={(value) => void update({ [key]: value })} />;
  const manage = (label: Parameters<BrowserTranslate>[0], target: Manager) => <ui.NavigationRow
    icon={target === 'bookmarks' ? <BrowserFavoritesIcon aria-hidden="true" size={18} /> : target === 'history' ? <BrowserHistoryIcon aria-hidden="true" size={18} /> : undefined}
    label={t(label)} actionLabel={t('feature.browser.settings.manage')} onClick={() => setManager(target)} />;
  const dialogProps = { bridge, translate: t, ui, onClose: () => setManager(null) };
  return <ui.PageLayout title={t('feature.browser.settings.title')}>
    <ui.Section className="browser-settings" featureId="browser">
    <ui.Group>
      <ui.Toggle
        icon={<BrowserFeatureIcon size={22} />}
        label={t('feature.browser.settings.agentControl')}
        description={null}
        checked={preferences.agentControl}
        disabled={busy}
        onChange={(agentControl) => void update({ agentControl })}
      />
    </ui.Group>
    <ui.Group title={t('feature.browser.settings.general')}>
      <ui.Row label={t('feature.browser.settings.searchEngine')}><ui.SelectField className="sd-settings-select--compact" aria-label={t('feature.browser.settings.searchEngine')} value={preferences.searchEngine} disabled={busy} onValueChange={(searchEngine) => void update({ searchEngine: searchEngine as BrowserSearchEngine })}>
        <option value="bing">Bing</option><option value="google">Google</option><option value="baidu">百度</option><option value="duckduckgo">DuckDuckGo</option>
      </ui.SelectField></ui.Row>
      <ui.Row label={t('feature.browser.settings.homeUrl')}><form className="browser-settings__actions" onSubmit={(event) => { event.preventDefault(); void update({ homeUrl: home.trim() }); }}>
        <ui.TextField type="url" value={home} aria-label={t('feature.browser.settings.homeUrl')} placeholder={t('feature.browser.settings.homePlaceholder')} onChange={(event) => setHome(event.target.value)} />
        <ui.Button type="submit" disabled={busy || home === preferences.homeUrl}>{t('feature.browser.settings.save')}</ui.Button>
      </form></ui.Row>
      {toggle('useExtensionNewTab')}
      {navigation ? <ui.NavigationRow label={t('feature.browser.settings.network')} actionLabel={t('feature.browser.settings.manage')} onClick={() => navigation.openSettings('network-proxy')} /> : null}
    </ui.Group>
    {children}
    <ui.Group title={t('feature.browser.settings.appearance')}>
      {toggle('showHomeButton')}{toggle('showFullUrl')}{toggle('spellcheck')}
      <ui.Row label={t('feature.browser.settings.defaultZoom')}><ui.SelectField className="sd-settings-select--compact" aria-label={t('feature.browser.settings.defaultZoom')} disabled={busy} value={String(preferences.defaultZoom)} onValueChange={(value) => void update({ defaultZoom: Number(value) })}>
        {[0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
      </ui.SelectField></ui.Row>
    </ui.Group>
    <ui.Group title={t('feature.browser.settings.privacy')}>
      {toggle('rememberHistory')}
      {manage('feature.browser.settings.history', 'history')}{manage('feature.browser.settings.bookmarks', 'bookmarks')}
      <ui.Row label={t('feature.browser.settings.clearData')}><ui.Button onClick={() => setManager('clear')}>{t('feature.browser.settings.clearData')}</ui.Button></ui.Row>
    </ui.Group>
    <ui.Group title={t('feature.browser.settings.passwordGroup')}>
      {toggle('savePasswords')}{toggle('autofillPasswords')}{manage('feature.browser.settings.passwords', 'passwords')}
    </ui.Group>
    <ui.Group title={t('feature.browser.settings.permissions')}>
      {BROWSER_PERMISSIONS.map((permission) => <ui.Row key={permission} label={t(`feature.browser.settings.${permission}`)}><ui.SelectField className="sd-settings-select--compact" aria-label={t(`feature.browser.settings.${permission}`)} disabled={busy} value={preferences.permissions[permission]} onValueChange={(value) => void update({ permissions: { [permission]: value as BrowserPermissionPolicy } })}>
        {(['ask', 'allow', 'block'] as const).map((value) => <option key={value} value={value}>{t(`feature.browser.settings.${value}`)}</option>)}
      </ui.SelectField></ui.Row>)}
      {manage('feature.browser.settings.sitePermissions', 'permissions')}
    </ui.Group>
    <ui.Group title={t('feature.browser.settings.downloads')}>
      <ui.Row label={t('feature.browser.settings.downloadDirectory')}><span className="browser-settings__path" title={preferences.downloadDirectory}>{preferences.downloadDirectory || t('feature.browser.settings.systemDownloads')}</span><ui.Button disabled={busy} onClick={() => void run(() => bridge.chooseBrowserDownloadDirectory())}>{t('feature.browser.settings.change')}</ui.Button></ui.Row>
      {toggle('askDownloadLocation')}
    </ui.Group>
    <ui.Group title={t('feature.browser.extension.label')}>{manage('feature.browser.extension.label', 'extensions')}</ui.Group>
    {error ? <ui.Toast tone="error" message={t('feature.browser.settings.failed')} /> : null}
    {manager === 'clear' ? <BrowserClearDataDialog {...dialogProps} /> : null}
    </ui.Section>
  </ui.PageLayout>;
}
