import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { BrowserImportService } from '../../src/main/import/service.js';

const directory = process.argv[2]; const phase = process.argv[3];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();

async function writeExtension(profile: string, name: string, marker: string): Promise<string> {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bytes = publicKey.export({ type: 'spki', format: 'der' });
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const target = path.join(profile, 'Extensions', id, '1.0.0_0');
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify({ key: bytes.toString('base64'), manifest_version: 3, name, version: '1.0.0',
    content_scripts: [{ matches: ['https://import.test/*'], js: ['content.js'] }] }));
  await writeFile(path.join(target, 'content.js'), `document.documentElement.dataset.${marker} = 'yes';`);
  return id;
}

async function main() {
  await app.whenReady();
  const chromeRoot = path.join(directory, 'Chrome'); const edgeRoot = path.join(directory, 'Edge');
  const chrome = path.join(chromeRoot, 'Default'); const edge = path.join(edgeRoot, 'Profile 2');
  if (phase === 'import') {
    await mkdir(chrome, { recursive: true }); await mkdir(edge, { recursive: true });
    const enabled = await writeExtension(chrome, 'Enabled import', 'enabledImport');
    const disabled = await writeExtension(edge, 'Disabled import', 'disabledImport');
    await writeFile(path.join(edge, 'Secure Preferences'), JSON.stringify({ extensions: { settings: { [disabled]: { state: 0 } } } }));
    await writeFile(path.join(directory, 'ids.json'), JSON.stringify({ enabled, disabled }));
  }
  const ids = JSON.parse(await readFile(path.join(directory, 'ids.json'), 'utf8')) as { enabled: string; disabled: string };
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  browserSession.protocol.handle('https', () => new Response('<!doctype html><title>Import fixture</title>', { headers: { 'Content-Type': 'text/html' } }));
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const extensions = new BrowserExtensionService({ session: browserSession, preloadPath: path.join(directory, 'actions.cjs'),
    language: () => 'en-US', publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined,
    owner: (contents) => contents.hostWebContents?.id === owner.webContents.id ? owner : null });
  try {
    await extensions.start();
    const importer = new BrowserImportService([{ browser: 'chrome', directory: chromeRoot }, { browser: 'edge', directory: edgeRoot }], extensions, () => 'en');
    assert.deepEqual((await importer.listProfiles()).map((item) => item.id), ['chrome:Default', 'edge:Profile 2']);
    if (phase === 'import') {
      assert.deepEqual(await importer.importExtensions('chrome:Default', [ids.enabled], new AbortController().signal), { imported: [ids.enabled], skipped: [], failed: [] });
      assert.deepEqual(await importer.importExtensions('edge:Profile 2', [ids.disabled], new AbortController().signal), { imported: [ids.disabled], skipped: [], failed: [] });
      // Subsequent execution must come from the application's copy, independently of source files.
      await writeFile(path.join(chrome, 'Extensions', ids.enabled, '1.0.0_0', 'content.js'), 'throw new Error("source changed");');
    }
    assert.equal(extensions.list().find((item) => item.id === ids.enabled)?.enabled, true);
    assert.equal(extensions.list().find((item) => item.id === ids.disabled)?.enabled, false);
    assert.equal(browserSession.extensions.getExtension(ids.disabled), null);
    assert.deepEqual(await importer.importExtensions('chrome:Default', [ids.enabled], new AbortController().signal), { imported: [], skipped: [ids.enabled], failed: [] });
    const attached = new Promise<Electron.WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="about:blank"></webview>`);
    const guest = await attached;
    if (phase === 'import') {
      const parser = await readFile(path.join(directory, 'bookmarks.js'), 'utf8');
      const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bar</H3><DL><p>'
        + '<DT><H3>Work</H3><DL><p><DT><A HREF="https://example.test" ADD_DATE="1700000000">Child &amp; One</A>'
        + '</DL><p></DL><p><DT><A HREF="https://other.test">Other</A></DL><p>';
      const parsed = await owner.webContents.executeJavaScript(`${parser}; BrowserBookmarkImport.parseBookmarkHtml(${JSON.stringify(html)}, 'native').nodes`);
      const work = parsed.find((node: { title: string }) => node.title === 'Work');
      assert.equal(work.parentId, 'bookmarks-bar');
      assert.equal(parsed.find((node: { title: string }) => node.title === 'Child & One').parentId, work.id);
      assert.equal(parsed.find((node: { title: string }) => node.title === 'Other').parentId, 'other-bookmarks');
    }
    const untrack = extensions.track(guest);
    try {
      await guest.loadURL('https://import.test/');
      const deadline = Date.now() + 5000;
      while (!(await guest.executeJavaScript('document.documentElement.dataset.enabledImport === "yes"'))) {
        if (Date.now() > deadline) throw new Error('Imported native content script did not execute.');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(await guest.executeJavaScript('document.documentElement.dataset.disabledImport'), undefined);
    } finally { untrack(); }
    console.log(`BROWSER_IMPORT_${phase.toUpperCase()}_OK`);
  } finally { extensions.dispose(); owner.destroy(); }
}

void main().then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });
