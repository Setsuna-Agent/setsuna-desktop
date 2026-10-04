import { useState } from 'react';
import { Plus, Pencil, Globe, Trash2 } from 'lucide-react';
import type { BrowserSettingsContentProps } from './types.js';
import { useBrowserSavedPasswords } from './useBrowserSavedPasswords.js';
import { BrowserSettingsSearch } from './BrowserSettingsSearch.js';

export function BrowserPasswordManager({ bridge, translate: t, ui }: BrowserSettingsContentProps) {
  const { items, status, busy, error, save, remove } = useBrowserSavedPasswords(bridge);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ origin: string; username: string; password: string; existing: boolean } | null>(null);
  const filtered = items.filter((item) => `${item.origin} ${item.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  const saveEditor = async () => {
    if (!editor) return;
    if (await save({ origin: editor.origin, username: editor.username, password: editor.password })) setEditor(null);
  };
  return <div className="browser-settings-collection">
    {editor ? <form className="browser-settings__form browser-settings-page__card browser-settings-page__form" onSubmit={(event) => { event.preventDefault(); void saveEditor(); }}>
      <h2>{t(editor.existing ? 'feature.browser.settings.edit' : 'feature.browser.settings.add')}</h2>
      <label>{t('feature.browser.settings.origin')}<ui.TextField type="url" required readOnly={editor.existing} value={editor.origin} onChange={(event) => setEditor({ ...editor, origin: event.target.value })} /></label>
      <label>{t('feature.browser.password.username')}<ui.TextField autoComplete="off" readOnly={editor.existing} value={editor.username} maxLength={512} onChange={(event) => setEditor({ ...editor, username: event.target.value })} /></label>
      <label>{t('feature.browser.password.password')}<ui.TextField type="password" autoComplete="new-password" required value={editor.password} maxLength={4096} onChange={(event) => setEditor({ ...editor, password: event.target.value })} /></label>
      <div className="browser-settings__actions"><ui.Button disabled={busy} onClick={() => setEditor(null)}>{t('feature.browser.settings.cancel')}</ui.Button><ui.Button variant="primary" type="submit" disabled={busy}>{t('feature.browser.settings.save')}</ui.Button></div>
    </form> : <>
      <BrowserSettingsSearch label={t('feature.browser.settings.search')} value={query} onChange={setQuery} />
      <div className="browser-settings-page__toolbar">
        <div className="browser-settings-page__actions"><ui.Button disabled={busy} icon={<Plus size={14} />} onClick={() => setEditor({ origin: '', username: '', password: '', existing: false })}>{t('feature.browser.settings.add')}</ui.Button></div>
      </div>
      <div className="browser-settings-page__card">{status === 'ready' && filtered.length ? <ul className="browser-settings-page__list">{filtered.map((item) => <li key={item.id}>
        <Globe size={16} aria-hidden="true" />
        <div className="browser-settings__entry"><strong>{item.origin}</strong><span>{item.username || t('feature.browser.password.noUsername')}</span></div>
        <ui.IconButton label={t('feature.browser.settings.edit')} disabled={busy} onClick={() => setEditor({ ...item, password: '', existing: true })}><Pencil size={14} /></ui.IconButton>
        <ui.IconButton label={t('feature.browser.settings.remove')} disabled={busy} onClick={() => void remove(item)}><Trash2 size={14} /></ui.IconButton>
      </li>)}</ul> : <p className="browser-settings-page__status" role={status === 'error' ? 'alert' : 'status'}>
        {t(status === 'loading' ? 'feature.browser.settings.loading' : status === 'error' ? 'feature.browser.settings.failed' : 'feature.browser.settings.empty')}
      </p>}</div>
    </>}
    {error ? <ui.Toast tone="error" message={t('feature.browser.settings.failed')} /> : null}
  </div>;
}
