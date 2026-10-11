import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, nativeImage, session } from 'electron';
import { loadWebsiteFavicon } from '../../src/main/favicon.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();

async function main() {
  await app.whenReady();
  const png = nativeImage.createFromBuffer(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG();
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  icoHeader[6] = 1;
  icoHeader[7] = 1;
  icoHeader.writeUInt16LE(1, 10);
  icoHeader.writeUInt16LE(32, 12);
  icoHeader.writeUInt32LE(png.length, 14);
  icoHeader.writeUInt32LE(22, 18);
  const ico = Buffer.concat([icoHeader, png]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="red"/></svg>';
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/site/')) {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<head><base href="/assets/"><link rel="icon" href="${request.url.slice('/site/'.length)}"></head>`);
    } else if (request.url === '/assets/ico' || request.url === '/assets/svg') {
      response.writeHead(200, { 'Content-Type': request.url.endsWith('svg') ? 'image/svg+xml' : 'image/x-icon' });
      response.end(request.url.endsWith('svg') ? svg : ico);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await owner.loadURL('data:text/html,<!doctype html><title>Icon conversion</title>');
    const renderer = await readFile(path.join(process.argv[2], 'avatar.js'), 'utf8');
    await owner.webContents.executeJavaScript(renderer);
    for (const format of ['ico', 'svg']) {
      const icon = await loadWebsiteFavicon(session.defaultSession, `http://127.0.0.1:${address.port}/site/${format}`);
      assert.ok(icon?.startsWith(format === 'ico' ? 'data:image/vnd.microsoft.icon;' : 'data:image/svg+xml;'));
      const avatar = await owner.webContents.executeJavaScript(`WebsiteIcon.websiteIconToAvatar(${JSON.stringify(icon)})`);
      assert.equal(avatar.type, 'custom');
      assert.ok(avatar.dataUrl.startsWith('data:image/png;base64,'));
      const image = nativeImage.createFromDataURL(avatar.dataUrl);
      assert.equal(image.isEmpty(), false);
      assert.deepEqual(image.getSize(), format === 'ico' ? { width: 1, height: 1 } : { width: 128, height: 128 });
    }
    console.log('WEBSITE_ICON_OK');
  } finally {
    owner.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
