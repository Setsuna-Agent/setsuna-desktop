import { useState } from 'react';
import { IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import { FolderPlus, Search } from 'lucide-react';
import type { BrowserBookmarkNode } from '../../contracts/bookmarks.js';
import { useBrowserBookmarks } from '../useBrowserBookmarks.js';
import type { BrowserRecordsProps } from './BrowserRecordsManager.js';
import { BrowserRecordsHeader } from './BrowserRecordsHeader.js';
import { BrowserRecordsConfirmation } from './BrowserRecordsConfirmation.js';
import { BrowserBookmarkEditor, type BrowserBookmarkEdit } from './BrowserBookmarkEditor.js';
import { BrowserBookmarkList } from './BrowserBookmarkList.js';
import { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID } from './bookmarkTree.js';
import { BrowserSettingsSearch } from '../settings/BrowserSettingsSearch.js';
import { BrowserFavoritesIcon } from './recordIcons.js';

export function BrowserBookmarkRecords(props: BrowserRecordsProps) {
  const { translate: t, onNavigate, onClose, pinned, currentPage, presentation } = props;
  const isPage = presentation === 'page';
  const bookmarks = useBrowserBookmarks();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set([BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID]));
  const [selected, setSelected] = useState(BOOKMARK_BAR_ID);
  const [edit, setEdit] = useState<BrowserBookmarkEdit | null>(null);
  const [removing, setRemoving] = useState<BrowserBookmarkNode | null>(null);
  const parentId = bookmarks.tree.nodes.some((node) => node.id === selected && node.type === 'folder') ? selected : BOOKMARK_BAR_ID;
  const editorTitle = edit?.type === 'folder'
    ? t(edit.node ? 'feature.browser.records.editFolder' : 'feature.browser.records.addFolder')
    : t(edit?.node ? 'feature.browser.records.editBookmark' : 'feature.browser.records.addBookmark');
  const actions = !edit && !removing ? <>
      <IconButton label={t('feature.browser.records.addBookmark')} onClick={() => setEdit({ type: 'bookmark', parentId, ...currentPage })}><BrowserFavoritesIcon aria-hidden="true" size={14} /></IconButton>
      <IconButton label={t('feature.browser.records.addFolder')} onClick={() => setEdit({ type: 'folder', parentId })}><FolderPlus size={14} /></IconButton>
    </> : null;
  return <>
    {isPage ? <>
      {!edit && !removing ? <BrowserSettingsSearch label={t('feature.browser.records.searchBookmarks')} value={query} onChange={setQuery} /> : null}
      <div className="browser-settings-page__toolbar">{edit ? <h2>{editorTitle}</h2> : null}<div className="browser-settings-page__actions">{actions}</div></div>
    </> : <BrowserRecordsHeader {...props} title={edit ? editorTitle : t('feature.browser.settings.bookmarks')} actions={actions} />}
    {edit ? <BrowserBookmarkEditor edit={edit} tree={bookmarks.tree} translate={t} onCancel={() => setEdit(null)} onSave={(draft) => {
      if (!bookmarks.save(draft, edit.type, edit.node?.id)) return false;
      // Reveal the destination after moving, including collapsed ancestors.
      setExpanded((current) => {
        const next = new Set(current);
        let id: string | null = draft.parentId;
        while (id) { next.add(id); id = bookmarks.tree.nodes.find((node) => node.id === id)?.parentId ?? null; }
        return next;
      });
      setSelected(draft.parentId);
      setQuery('');
      setEdit(null);
      return true;
    }} /> : removing ? <BrowserRecordsConfirmation title={t('feature.browser.records.deleteFolderConfirm')} translate={t}
      onCancel={() => setRemoving(null)} onConfirm={() => { if (bookmarks.remove(removing.id)) setRemoving(null); }} /> : <>
      {!isPage ? <div className="browser-records__search"><Search size={14} aria-hidden="true" /><TextField
        aria-label={t('feature.browser.settings.search')} placeholder={t('feature.browser.records.searchBookmarks')}
        value={query} onChange={(event) => setQuery(event.target.value)} /></div> : null}
      <BrowserBookmarkList tree={bookmarks.tree} query={query} expanded={expanded} selected={selected} translate={t}
        onToggleFolder={(id) => {
          setSelected(id);
          setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
        }}
        onOpen={onNavigate ? (url) => { if (!pinned && !isPage) onClose(); onNavigate(url); } : undefined}
        onEdit={(node) => setEdit({ type: node.type, parentId: node.parentId ?? BOOKMARK_BAR_ID, node })}
        onRemove={(node) => { if (node.type === 'folder') setRemoving(node); else bookmarks.remove(node.id); }} />
    </>}
    {bookmarks.error ? <p role="alert" className="browser-records__error">{t('feature.browser.settings.failed')}</p> : null}
  </>;
}
