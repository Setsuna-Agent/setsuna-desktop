import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { BROWSER_PERMISSIONS, type BrowserPreferences, type BrowserPermissionPolicy } from '../../contracts/settings.js';
import type { BrowserSettingsContentProps } from './types.js';
import { useBrowserPreferences } from './useBrowserPreferences.js';
import { BrowserSettingsSearch } from './BrowserSettingsSearch.js';

export function BrowserSitePermissions({ bridge, translate: t, ui }: BrowserSettingsContentProps) {
  const { preferences, update, busy, error, ready } = useBrowserPreferences(bridge);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ origin: string; rules: BrowserPreferences['sitePermissions'][string]; existing: boolean } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = async () => {
    if (!editor) return;
    let url: URL;
    try {
      url = new URL(editor.origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid origin');
    } catch { setInvalid(true); return; }
    if (await update({ sitePermissions: { ...preferences.sitePermissions, [url.origin]: editor.rules } })) setEditor(null);
  };
  const sites = Object.entries(preferences.sitePermissions).filter(([origin]) => origin.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="browser-settings-collection">
    {editor ? <form className="browser-settings__form browser-settings-page__card browser-settings-page__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2>{t(editor.existing ? 'feature.browser.settings.edit' : 'feature.browser.settings.add')}</h2>
      <label>{t('feature.browser.settings.origin')}<ui.TextField type="url" required readOnly={editor.existing} value={editor.origin} onChange={(event) => { setInvalid(false); setEditor({ ...editor, origin: event.target.value }); }} /></label>
      {BROWSER_PERMISSIONS.map((permission) => <ui.Row key={permission} label={t(`feature.browser.settings.${permission}`)}>
        <ui.SelectField className="sd-settings-select--compact" aria-label={t(`feature.browser.settings.${permission}`)} disabled={busy} value={editor.rules[permission] ?? 'inherit'} onValueChange={(value) => {
          const rules = { ...editor.rules };
          if (value === 'inherit') delete rules[permission]; else rules[permission] = value as BrowserPermissionPolicy;
          setEditor({ ...editor, rules });
        }}><option value="inherit">{t('feature.browser.settings.inherit')}</option>{(['ask', 'allow', 'block'] as const).map((value) => <option key={value} value={value}>{t(`feature.browser.settings.${value}`)}</option>)}</ui.SelectField>
      </ui.Row>)}
      <div className="browser-settings__actions"><ui.Button disabled={busy} onClick={() => setEditor(null)}>{t('feature.browser.settings.cancel')}</ui.Button><ui.Button variant="primary" disabled={busy} type="submit">{t('feature.browser.settings.save')}</ui.Button></div>
    </form> : <>
      <BrowserSettingsSearch label={t('feature.browser.settings.search')} value={query} onChange={setQuery} />
      <div className="browser-settings-page__toolbar"><div className="browser-settings-page__actions"><ui.Button icon={<Plus size={14} />} disabled={busy || !ready} onClick={() => { setInvalid(false); setEditor({ origin: '', rules: {}, existing: false }); }}>{t('feature.browser.settings.add')}</ui.Button></div></div>
      <div className="browser-settings-page__card">{sites.length ? <ul className="browser-settings-page__list">{sites.map(([origin, rules]) => <li key={origin}><span className="browser-settings__entry">{origin}</span>
        <ui.IconButton label={t('feature.browser.settings.edit')} disabled={busy} onClick={() => { setInvalid(false); setEditor({ origin, rules, existing: true }); }}><Pencil size={14} /></ui.IconButton>
        <ui.IconButton label={t('feature.browser.settings.remove')} disabled={busy} onClick={() => { const sites = { ...preferences.sitePermissions }; delete sites[origin]; void update({ sitePermissions: sites }); }}><Trash2 size={14} /></ui.IconButton>
      </li>)}</ul> : <p className="browser-settings-page__status">{t(!ready ? error ? 'feature.browser.settings.failed' : 'feature.browser.settings.loading' : 'feature.browser.settings.empty')}</p>}</div>
    </>}
    {error || invalid ? <ui.Toast tone="error" message={t(invalid ? 'feature.browser.settings.invalidUrl' : 'feature.browser.settings.failed')} /> : null}
  </div>;
}
