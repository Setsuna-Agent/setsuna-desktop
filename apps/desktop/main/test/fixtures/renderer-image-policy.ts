import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerRendererImagePolicy } from '../../src/window/renderer-image-policy.js';

const root = process.argv[2];
app.setPath('userData', path.join(root, 'user-data'));
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const assets = path.join(root, 'renderer');
  await mkdir(assets);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(assets, 'icon.png'), png);
  await writeFile(path.join(root, 'private.png'), png);
  await writeFile(path.join(assets, 'index.html'), '<!doctype html><html><body></body></html>');
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(png); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing preview address');
  const baseline = new BrowserWindow({ show: false });
  const baselineStart = performance.now();
  await baseline.loadFile(path.join(assets, 'index.html'));
  const baselineMs = performance.now() - baselineStart;
  if (!await imageLoads(baseline, pathToFileURL(path.join(root, 'private.png')).href)) {
    throw new Error('The loadFile baseline did not reproduce unrestricted local image loading.');
  }
  const windows = [new BrowserWindow({ show: false }), new BrowserWindow({ show: false })];
  const guardedMs: number[] = [];
  try {
    for (const window of windows) {
      const started = performance.now();
      registerRendererImagePolicy(window, assets);
      await window.loadFile(path.join(assets, 'index.html'));
      guardedMs.push(performance.now() - started);
    }
    const urls = [pathToFileURL(path.join(root, 'private.png')).href, '../private.png',
      pathToFileURL(path.join(assets, 'icon.png')).href, `http://127.0.0.1:${address.port}/preview.png`];
    for (const window of windows) {
      const result = await window.webContents.executeJavaScript(`Promise.all(${JSON.stringify(urls)}.map(src => new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = src;
      })))`);
      if (JSON.stringify(result) !== '[false,false,true,true]') throw new Error(`Image boundary failed: ${JSON.stringify(result)}`);
      // Closing the first window must not remove the second window's session policy.
      window.destroy();
    }
    console.log('RENDERER_IMAGE_POLICY_OK', JSON.stringify({ baselineMs, guardedMs }));
  } finally {
    baseline.destroy();
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    server.close();
  }
}

async function imageLoads(window: BrowserWindow, src: string): Promise<boolean> {
  return window.webContents.executeJavaScript(`new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = ${JSON.stringify(src)};
  })`);
}

void main().then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });
