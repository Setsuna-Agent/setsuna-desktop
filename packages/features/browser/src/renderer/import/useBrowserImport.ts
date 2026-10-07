import { useEffect, useRef, useState } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';
import type { BrowserImportPreview, BrowserImportProfile, BrowserExtensionImportResult } from '../../contracts/import.js';
import { readBrowserBookmarkTree, writeBrowserBookmarkTree } from '../browserBookmarks.js';
import type { BrowserTranslate } from '../messages.js';
import { mergeImportedBookmarks, parseBookmarkHtml } from './bookmarks.js';

type ImportNotice = { tone: 'error' | 'success' | 'warning'; message: string };

export function useBrowserImport(bridge: BrowserDesktopBridge, t: BrowserTranslate) {
  const [profiles, setProfiles] = useState<readonly BrowserImportProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [preview, setPreview] = useState<BrowserImportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState(true);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<ImportNotice | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let active = true;
    void bridge.listBrowserImportProfiles().then((items) => {
      if (!active) return;
      setProfiles(items); setProfileId(items[0]?.id ?? '');
      if (!items.length) setLoading(false);
    }).catch(() => { if (active) { setLoading(false); setNotice({ tone: 'error', message: t('feature.browser.import.failed') }); } });
    return () => { active = false; };
  }, [bridge, t]);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    setLoading(true); setPreview(null); setSelected([]); setNotice(null);
    void bridge.previewBrowserImport(profileId).then((data) => {
      if (!active) return;
      setPreview(data); setSelected(data.extensions.filter((item) => item.compatible && !item.installed).map((item) => item.id));
    }).catch(() => { if (active) setNotice({ tone: 'error', message: t('feature.browser.import.failed') }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bridge, profileId, t]);

  const selectProfile = (id: string) => {
    if (id === profileId) return;
    setPreview(null); setSelected([]); setNotice(null); setProfileId(id);
  };
  const selectExtension = (id: string, checked: boolean) => setSelected((current) => checked
    ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  const completed = (bookmarks: number, extensions: number) => t('feature.browser.import.completed')
    .replace('{bookmarks}', String(bookmarks)).replace('{extensions}', String(extensions));

  const run = async (operation: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setNotice(null);
    try { await operation(); }
    catch { setNotice({ tone: 'error', message: t('feature.browser.import.failed') }); }
    finally { running.current = false; setBusy(false); }
  };
  const importSelected = () => run(async () => {
    if (!preview || (!favorites && !selected.length)) return;
    let count = 0;
    if (favorites) {
      const merged = mergeImportedBookmarks(readBrowserBookmarkTree(), preview.bookmarks);
      writeBrowserBookmarkTree(merged.tree); count = merged.added;
    }
    let result: BrowserExtensionImportResult;
    try {
      result = selected.length ? await bridge.importBrowserExtensions(profileId, selected)
        : { imported: [], skipped: [], failed: [] };
    } catch {
      // Favorites have already committed. A lost native reply must not imply they were rolled back.
      setNotice({ tone: 'warning', message: (favorites ? `${t('feature.browser.import.bookmarksCompleted').replace('{count}', String(count))}\n` : '')
        + t('feature.browser.import.extensionsIncomplete') });
      return;
    }
    const installed = new Set([...result.imported, ...result.skipped]);
    setPreview({ ...preview, extensions: preview.extensions.map((item) => installed.has(item.id) ? { ...item, installed: true } : item) });
    setSelected(result.failed);
    const failed = result.failed.map((id) => preview.extensions.find((item) => item.id === id)?.name ?? id).join('、');
    setNotice({ tone: failed ? 'warning' : 'success', message: completed(count, result.imported.length)
      + (failed ? `\n${t('feature.browser.import.extensionsFailed').replace('{names}', failed)}` : '') });
  });
  const importHtml = () => run(async () => {
    const file = await bridge.chooseBrowserBookmarkFile();
    if (!file) return;
    const imported = parseBookmarkHtml(file.html, file.sourceId);
    const merged = mergeImportedBookmarks(readBrowserBookmarkTree(), imported);
    writeBrowserBookmarkTree(merged.tree);
    setNotice({ tone: 'success', message: completed(merged.added, 0) });
  });
  return { profiles, profileId, selectProfile, preview, loading, busy, favorites, setFavorites,
    selected, setSelected, selectExtension, notice, importSelected, importHtml };
}
