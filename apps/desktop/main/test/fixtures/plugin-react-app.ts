import { app, BrowserWindow, dialog, protocol } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginUiDocumentScheme } from '../../src/window/plugin-ui-documents.js';
import { registerPluginUiDocumentIpc } from '../../src/ipc/plugin-ui-document-ipc.js';
import { desktopWindows } from '../../src/window/registry.js';

protocol.registerSchemesAsPrivileged([pluginUiDocumentScheme]);
app.setPath('userData', process.argv[2]);
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false,
    contextIsolation: true, backgroundThrottling: false, preload: path.join(process.argv[2], 'preload.cjs') } });
  desktopWindows.add(owner); registerPluginUiDocumentIpc();
  owner.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  let approvals = 0;
  dialog.showMessageBox = (async () => { approvals++; return { response: 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
  try {
    const host = path.join(process.argv[2], 'host.html'); await writeFile(host, '<!doctype html><html><body></body></html>');
    await owner.loadFile(host);
    await owner.webContents.executeJavaScript(await readFile(path.join(process.argv[2], 'frame.js'), 'utf8'));
    const source = JSON.parse(await readFile(path.join(process.argv[2], 'source.json'), 'utf8'));
    const mount = () => owner.webContents.executeJavaScript(`window.reactApp.mount(${JSON.stringify(source)}, ${JSON.stringify(process.argv[3])})`);
    const frame = async () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const child = owner.webContents.mainFrame.frames.find(frame => frame.url.startsWith('setsuna-plugin-ui:'));
        if (child && await child.executeJavaScript('Boolean(document.querySelector("#count"))')) return child;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('React app failed to mount');
    };
    await mount(); const page = await frame();
    assert.equal(await page.executeJavaScript('document.querySelector("#count").textContent'), '0');
    assert.deepEqual(await page.executeJavaScript(`(async () => {
      let isolated = false; try {parent.document.body} catch {isolated = true}
      const permission = await navigator.permissions.query({name:'geolocation'});
      const response = await window.setsunaUI.runtime.request({path:'/v1/projects'});
      return {isolated, node:typeof process, permission:permission.state, project:response.data.projects[0].id};
    })()`), { isolated: true, node: 'undefined', permission: 'denied', project: 'project-real' });
    await page.executeJavaScript(`navigator.geolocation.getCurrentPosition(() => {}, () => {});`);
    await page.executeJavaScript(`const input = document.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Shared note');
      input.dispatchEvent(new Event('input', {bubbles:true}));`);
    await page.executeJavaScript(`window.snapshotNotifications = 0;
      window.setsunaUI.subscribe(() => window.snapshotNotifications++);`);
    // A fresh state read and a theme delivery both clone snapshots across MessagePort.
    // Neither may make React discard a draft when the business data is unchanged.
    for (const [index, notification] of [
      'window.reactApp.notify()', "document.documentElement.dataset.theme = 'dark'",
    ].entries()) {
      await owner.webContents.executeJavaScript(notification);
      for (let attempt = 0; await page.executeJavaScript(`window.snapshotNotifications >= ${index + 1}`) !== true; attempt++) {
        if (attempt > 200) throw new Error('Snapshot notification did not reach the page');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(await page.executeJavaScript('document.querySelector("input").value'), 'Shared note');
    }
    await page.executeJavaScript('document.querySelector("button[type=submit]").click()');
    for (let attempt = 0; await page.executeJavaScript('document.querySelector("#count").textContent') !== '1'; attempt++) {
      if (attempt > 200) throw new Error('Persisted state was not projected to React');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await page.executeJavaScript('document.querySelector("a[href=\\"#/detail/42\\"]").click()');
    assert.equal(await page.executeJavaScript('document.querySelector("#route")?.textContent'), '42');
    assert.equal(await page.executeJavaScript('document.querySelector("#saved")?.textContent'), '1');
    assert.ok(page.url.endsWith('#/detail/42'));
    await page.executeJavaScript('location.hash = "#/openui"');
    for (let attempt = 0; await page.executeJavaScript('Boolean(document.querySelector("[role=option]"))') !== true; attempt++) {
      if (attempt > 200) throw new Error('OpenUI guide page failed to mount');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const selection = () => page.executeJavaScript(`({
      period: document.querySelector('[role=option][aria-selected=true]')?.textContent,
      chart: document.querySelector('[role=radio][aria-checked=true]')?.textContent,
    })`);
    assert.deepEqual(await selection(), { period: '本周', chart: '柱状图' });
    await page.executeJavaScript(`Array.from(document.querySelectorAll('[role=option]')).find(el => el.textContent === '本月').click();
      Array.from(document.querySelectorAll('[role=radio]')).find(el => el.textContent === '折线图').click();`);
    assert.deepEqual(await selection(), { period: '本月', chart: '折线图' });
    const beforeTheme = await page.executeJavaScript('window.snapshotNotifications');
    await owner.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
    for (let attempt = 0; await page.executeJavaScript(`window.snapshotNotifications > ${beforeTheme}`) !== true; attempt++) {
      if (attempt > 200) throw new Error('OpenUI did not receive the theme notification');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(await selection(), { period: '本月', chart: '折线图' });
    await owner.webContents.executeJavaScript('window.reactApp.unmount()');
    await mount(); assert.equal(await (await frame()).executeJavaScript('document.querySelector("#count").textContent'), '1');
    assert.equal(owner.webContents.getURL(), pathToFileURL(host).href);
    assert.equal(approvals, 1);
    process.stdout.write('PLUGIN_REACT_APP_PASSED\n');
  } finally { owner.destroy(); }
}

void main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
