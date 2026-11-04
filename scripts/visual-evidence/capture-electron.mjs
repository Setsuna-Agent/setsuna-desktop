/* global window, localStorage, document, innerWidth, innerHeight, devicePixelRatio */
// Run only on a GitHub-hosted macOS runner, never the shared management host.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Visual verification is GitHub Actions-only.');
assert.equal(process.platform, 'darwin', 'Use the supported macOS Electron application.');
const [rootArg, label, outputArg, toolsArg] = process.argv.slice(2);
assert.ok(rootArg && ['before', 'after'].includes(label) && outputArg && toolsArg);
const root = path.resolve(rootArg);
const output = path.resolve(outputArg);
const requireTools = createRequire(path.join(path.resolve(toolsArg), 'package.json'));
const { _electron: electron } = requireTools('playwright');
const requireApp = createRequire(path.join(root, 'package.json'));
const executablePath = requireApp('electron');
await fs.mkdir(output, { recursive: true });
const profile = path.join(process.env.RUNNER_TEMP, `setsuna-visual-${label}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
await fs.mkdir(profile, { recursive: true });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const packageFile = path.join(root, 'package.json');
const originalPackage = await fs.readFile(packageFile, 'utf8');
const original = JSON.parse(originalPackage);
// Disposable CI-checkout launcher: redirect only native profile locations, then
// import the actual built application. No renderer, preload, or runtime stubs.
const launcher = path.join(root, '.visual-evidence-bootstrap.cjs');
await fs.writeFile(launcher, `const {app}=require('electron');\napp.setPath('appData', ${JSON.stringify(profile)});\napp.setPath('userData', ${JSON.stringify(path.join(profile, 'electron'))});\nimport(${JSON.stringify(pathToFileURL(path.resolve(root, original.main)).href)}).catch(error=>{console.error(error);app.exit(1)});\n`);
await fs.mkdir(path.join(profile, 'electron'), { recursive: true });
await fs.writeFile(packageFile, JSON.stringify({ ...original, main: path.basename(launcher) }, null, 2));
const logs = [];
let app;
let page;
try {
  app = await electron.launch({
    executablePath, args: [root], cwd: root, timeout: 120_000,
    env: { ...process.env, SETSUNA_DESKTOP_RUNTIME_ENTRY: path.join(root, 'packages/desktop-runtime/dist/cli.js') },
  });
  app.process().stdout?.on('data', chunk => logs.push(`MAIN ${chunk}`));
  app.process().stderr?.on('data', chunk => logs.push(`MAINERR ${chunk}`));
  await app.context().addInitScript(() => {
    localStorage.setItem('setusna-theme-mode', 'light');
    localStorage.setItem('setsuna-interface-language', 'en-US');
  });
  // Electron may create a splash first. Select the real renderer window rather
  // than assuming firstWindow() is the application settings surface.
  const deadline = Date.now() + 120_000;
  while (!page && Date.now() < deadline) {
    for (const candidate of app.windows()) {
      if (candidate.url().includes('renderer/index.html')) { page = candidate; break; }
    }
    if (!page) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'Actual renderer window did not open.');
  page.on('console', message => logs.push(`RENDERER ${message.type()} ${message.text()}`));
  page.on('pageerror', error => logs.push(`PAGEERROR ${error.stack}`));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('renderer/index.html'));
    window.setContentSize(1440, 1000);
    window.center();
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.waitForFunction(() => Boolean(window.setsunaDesktop?.runtime), undefined, { timeout: 120_000 });
  await page.evaluate(async () => {
    await window.setsunaDesktop.desktop.whenReady();
    const config = await window.setsunaDesktop.runtime.request({ path: '/v1/config' });
    await window.setsunaDesktop.runtime.request({ path: '/v1/config', method: 'PUT', body: {
      desktopSettings: { ...(config.desktopSettings ?? {}), interfaceLanguage: 'en-US' },
    } });
    localStorage.setItem('setusna-theme-mode', 'light');
    localStorage.setItem('setsuna-interface-language', 'en-US');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click({ timeout: 120_000 });
  const settingsNav = page.locator('nav.desktop-settings-sidebar');
  await settingsNav.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  const sync = settingsNav.getByRole('button', { name: 'Sync', exact: true });
  assert.equal(await sync.count(), label === 'before' ? 1 : 0, 'Unexpected Sync settings navigation.');
  if (label === 'before') await sync.waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  const general = `${label}-settings-general.png`;
  await page.screenshot({ path: path.join(output, general), animations: 'disabled' });
  await settingsNav.getByRole('button', { name: 'Proxy servers', exact: true }).click();
  await page.getByText('Proxy routing', { exact: true }).waitFor();
  const scope = page.getByText('WebDAV sync', { exact: true });
  assert.equal(await scope.count(), label === 'before' ? 1 : 0, 'Unexpected WebDAV proxy scope.');
  if (label === 'before') await scope.waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  const proxy = `${label}-settings-proxy.png`;
  await page.screenshot({ path: path.join(output, proxy), animations: 'disabled' });
  const screenshots = [];
  for (const name of [general, proxy]) {
    screenshots.push({ name, sha256: createHash('sha256').update(await fs.readFile(path.join(output, name))).digest('hex') });
  }
  const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }));
  assert.equal(geometry.width, 1440);
  assert.equal(geometry.height, 1000);
  await fs.writeFile(path.join(output, `${label}-provenance.json`), JSON.stringify({
    revision, label, capturedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    electron: await app.evaluate(() => process.versions.electron), chromium: await app.evaluate(() => process.versions.chrome),
    geometry, theme: 'light', locale: 'en-US', profile: 'fresh isolated development profile',
    scenario: 'Settings → General; Settings → Proxy servers', nativeBridge: 'real Electron preload and runtime; no stubs',
    settings: 'No model providers, threads, projects, proxy servers, WebDAV credentials, or external endpoints configured. Default system proxy route and inherited scope routes.',
    screenshots,
  }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await fs.writeFile(path.join(output, `${label}-failure-body.txt`), await page.locator('body').innerText()).catch(() => {});
    await page.screenshot({ path: path.join(output, `${label}-FAILURE-not-evidence.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await fs.writeFile(path.join(output, `${label}-console.txt`), logs.join('\n'));
  try {
    if (app) await app.close();
  } finally {
    await fs.writeFile(packageFile, originalPackage);
  }
}
