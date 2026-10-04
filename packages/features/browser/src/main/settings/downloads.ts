import { app, type Session, type DownloadItem } from 'electron';
import { closeSync, openSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { BrowserPreferencesStore } from './preferences.js';

/** Reserve a fresh name before disabling Electron's save dialog, avoiding silent overwrites. */
export function reserveBrowserDownload(directory: string, filename: string): string {
  const cleaned = Array.from(filename, (character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const name = path.basename(cleaned.replace(/[/\\]/g, '_')).replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/, '') || 'download';
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
  const extension = path.extname(safe);
  const stem = path.basename(safe, extension);
  for (let index = 0; index < 10_000; index++) {
    const target = path.join(directory, index ? `${stem} (${index})${extension}` : safe);
    try { closeSync(openSync(target, 'wx', 0o600)); return target; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  throw new Error('No available download filename.');
}

export function installBrowserDownloads(session: Session, preferences: BrowserPreferencesStore): () => void {
  const download = (_event: Electron.Event, item: DownloadItem) => {
    const settings = preferences.get();
    const directory = settings.downloadDirectory || app.getPath('downloads');
    if (settings.askDownloadLocation) {
      item.setSaveDialogOptions({ defaultPath: path.join(directory, path.basename(item.getFilename())) });
      return;
    }
    try {
      const target = reserveBrowserDownload(directory, item.getFilename());
      item.setSavePath(target);
      item.once('done', (_event, state) => {
        if (state === 'completed') return;
        try { if (statSync(target).size === 0) unlinkSync(target); } catch { /* Chromium may already have removed it. */ }
      });
    } catch {
      // An unavailable directory falls back to Electron's native save dialog.
      item.setSaveDialogOptions({ defaultPath: app.getPath('downloads') });
    }
  };
  session.on('will-download', download);
  return () => { session.off('will-download', download); };
}
