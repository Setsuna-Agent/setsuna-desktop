import { useState } from 'react';
import { Button, SelectField, TextField } from '@setsuna-desktop/renderer-ui';
import type { BrowserBookmarkDraft, BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import { bookmarkDescendants, normalizeBrowserBookmarkUrl } from './bookmarkTree.js';
import { bookmarkFolderOptions } from './bookmarkLabels.js';
import type { BrowserTranslate } from '../messages.js';

export type BrowserBookmarkEdit = { type: 'bookmark' | 'folder'; parentId: string; node?: BrowserBookmarkNode; title?: string; url?: string };
export function BrowserBookmarkEditor({ edit, tree, onSave, onCancel, translate: t }: {
  edit: BrowserBookmarkEdit;
  tree: BrowserBookmarkTree;
  onSave(input: BrowserBookmarkDraft): boolean;
  onCancel(): void;
  translate: BrowserTranslate;
}) {
  const [title, setTitle] = useState(edit.node?.title ?? edit.title ?? '');
  const [url, setUrl] = useState(edit.node?.type === 'bookmark' ? edit.node.url : edit.url ?? '');
  const [parentId, setParentId] = useState(edit.parentId);
  const [error, setError] = useState<'invalidUrl' | 'failed' | null>(null);
  const excluded = edit.node ? bookmarkDescendants(tree, edit.node.id) : new Set<string>();
  const folders = bookmarkFolderOptions(tree, t, excluded);
  return <form className="browser-records__editor" onSubmit={(event) => {
    event.preventDefault();
    const normalizedUrl = edit.type === 'bookmark' ? normalizeBrowserBookmarkUrl(url.trim()) : undefined;
    if (edit.type === 'bookmark' && !normalizedUrl) { setError('invalidUrl'); return; }
    if (!onSave({ title: title.trim(), parentId, ...(normalizedUrl ? { url: normalizedUrl } : {}) })) setError('failed');
  }}>
    <label>{t('feature.browser.records.name')}<TextField value={title} maxLength={240} required onChange={(event) => setTitle(event.target.value)} /></label>
    {edit.type === 'bookmark' ? <label>{t('feature.browser.records.url')}<TextField value={url} type="url" maxLength={8192} required onChange={(event) => setUrl(event.target.value)} /></label> : null}
    <label>{t('feature.browser.records.folder')}<SelectField aria-label={t('feature.browser.records.folder')} value={parentId} onValueChange={setParentId}>
      {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
    </SelectField></label>
    {error ? <span role="alert">{t(`feature.browser.settings.${error}`)}</span> : null}
    <div className="browser-records__actions"><Button onClick={onCancel}>{t('feature.browser.settings.cancel')}</Button>
      <Button variant="primary" type="submit">{t('feature.browser.settings.save')}</Button></div>
  </form>;
}
