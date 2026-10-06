import assert from 'node:assert/strict';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { BrowserAnnotationSession } from '../../src/main/annotations/session.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();

async function until(read: () => Promise<unknown>, label: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false } });
  const contents = window.webContents;
  const annotations = new BrowserAnnotationSession(contents);
  try {
    await window.loadURL(`data:text/html,${encodeURIComponent(`<!doctype html><title>Annotation capture</title>
      <style>body{margin:0}header{position:fixed;top:0;left:0;right:0;height:100px;background:white;z-index:10}
      main{padding-top:1000px;height:3000px}button{width:300px;height:40px;margin-left:100px}</style>
      <header>Fixed website navigation</header><main><button id="target">Selected annotation content</button></main>`)}`);
    await contents.executeJavaScript('window.scrollTo(0, 750)');
    const bounds = await contents.executeJavaScript('(() => { const r = document.querySelector("#target").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    const pending = annotations.pick();
    await until(() => contents.executeJavaScriptInIsolatedWorld(1_004, [{ code: 'Boolean(window.__setsunaAnnotations)' }]), 'annotation selection');
    contents.sendInputEvent({ type: 'mouseDown', x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
    const target = await pending;
    assert.equal(target?.text, 'Selected annotation content');
    await annotations.sync({ ids: [target!.id], visible: true });
    // The user can continue scrolling after selecting a target, before sending feedback.
    await contents.executeJavaScript('window.scrollTo(0, 1400)');
    const originalScroll = await contents.executeJavaScript('window.scrollY');
    let captured = 0;
    const images = await annotations.captureScreenshots([target!.id], async () => {
      const exposed = await contents.executeJavaScript(`(() => {
        const target = document.querySelector('#target');
        const rect = target.getBoundingClientRect();
        return target.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })()`);
      assert.equal(exposed, true, 'Captured content must not be hidden beneath fixed website navigation');
      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      assert.equal(image.isEmpty(), false);
      captured++;
      const png = image.toPNG();
      return { ...image.getSize(), dataUrl: `data:image/png;base64,${png.toString('base64')}`, mimeType: 'image/png' as const, size: png.byteLength };
    });
    assert.equal(images?.length, 1);
    assert.equal(captured, 1);
    assert.equal(await contents.executeJavaScript('window.scrollY'), originalScroll);
    // A page modal may cover the selection entirely. Do not attach a misleading screenshot.
    await contents.executeJavaScript(`(() => {
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;z-index:100;background:white';
      document.body.append(modal);
    })()`);
    assert.equal(await annotations.captureScreenshots([target!.id], async () => {
      captured++;
      throw new Error('Occluded content must not be captured');
    }), null);
    assert.equal(captured, 1);
    assert.equal(await contents.executeJavaScript('window.scrollY'), originalScroll);
    console.log('ANNOTATIONS_OK');
  } finally { annotations.dispose(); window.destroy(); }
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
