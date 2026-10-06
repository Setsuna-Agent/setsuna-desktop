import { useMemo, useState } from 'react';
import { Plus, Pencil, Globe, Trash2 } from 'lucide-react';
import type { BrowserSavedPassword } from '../../contracts/settings.js';
import type { BrowserSettingsContentProps } from './types.js';
import { useBrowserSavedPasswords } from './useBrowserSavedPasswords.js';
import { BrowserSettingsSearch } from './BrowserSettingsSearch.js';
import { groupBrowserSavedPasswords, type BrowserPasswordGroup } from './passwordGroups.js';
import './password-manager.css';

export function BrowserPasswordManager({ bridge, translate: t, ui }: BrowserSettingsContentProps) {
  const { items, status, busy, error, save, remove } = useBrowserSavedPasswords(bridge);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ origin: string; username: string; password: string; existing: boolean } | null>(null);
  const groups = useMemo(() => groupBrowserSavedPasswords(items, query), [items, query]);
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
      {status === 'ready' && groups.length ? (
        <div className="browser-password-manager__sites">
          {groups.map((group) => (
            <BrowserPasswordSite key={group.origin} group={group} busy={busy} translate={t} ui={ui}
              onEdit={(item) => setEditor({ ...item, password: '', existing: true })}
              onRemove={(item) => { void remove(item); }} />
          ))}
        </div>
      ) : (
        <div className="browser-settings-page__card">
          <p className="browser-settings-page__status" role={status === 'error' ? 'alert' : 'status'}>
            {t(status === 'loading' ? 'feature.browser.settings.loading' : status === 'error' ? 'feature.browser.settings.failed' : 'feature.browser.settings.empty')}
          </p>
        </div>
      )}
    </>}
    {error ? <ui.Toast tone="error" message={t('feature.browser.settings.failed')} /> : null}
  </div>;
}

function BrowserPasswordSite({ group, busy, translate: t, ui, onEdit, onRemove }: {
  group: BrowserPasswordGroup;
  busy: boolean;
  translate: BrowserSettingsContentProps['translate'];
  ui: Pick<BrowserSettingsContentProps['ui'], 'IconButton'>;
  onEdit(item: BrowserSavedPassword): void;
  onRemove(item: BrowserSavedPassword): void;
}) {
  return (
    <section className="browser-settings-page__card" aria-label={group.origin}>
      <header className="browser-password-manager__site-header">
        <Globe size={16} aria-hidden="true" />
        <h2 title={group.origin}>{group.origin}</h2>
      </header>
      <ul className="browser-settings-page__list browser-password-manager__accounts">
        {group.items.map((item) => (
          <li key={item.id}>
            <span className="browser-password-manager__username">{item.username || t('feature.browser.password.noUsername')}</span>
            <ui.IconButton label={t('feature.browser.settings.edit')} disabled={busy} onClick={() => onEdit(item)}><Pencil size={14} /></ui.IconButton>
            <ui.IconButton label={t('feature.browser.settings.remove')} disabled={busy} onClick={() => onRemove(item)}><Trash2 size={14} /></ui.IconButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
