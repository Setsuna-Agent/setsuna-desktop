import type { RuntimePluginUiReactApp } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { InstalledPluginRecord } from '../../ports/plugin-bundle-store.js';
import { pathIsInside, readBundleFileSnapshot, safeExistingPath } from '../plugin/file-plugin-bundle-model.js';
import { appPackageManifest, validateAppProjectFiles } from './project-manifest.js';

export const APP_BUILD_VERSION = 4;
export const appHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export async function appProjectSnapshot(plugin: InstalledPluginRecord, app: RuntimePluginUiReactApp) {
  const project = await safeExistingPath(plugin.installPath, app.root);
  const paths = (await directoryFiles(project)).map(file => `${app.root}/${file}`);
  const snapshot = await readBundleFileSnapshot(plugin.installPath, paths);
  if (!plugin.extension?.trustedHash || snapshot.bundleHash !== plugin.extension.trustedHash) throw new Error('React app source is no longer trusted.');
  validateAppProjectFiles(app, snapshot.files);
  return snapshot;
}

export async function appSdkSnapshot(): Promise<ReadonlyMap<string, Buffer>> {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('@setsuna/app/package.json'));
  const files = (await directoryFiles(path.join(root, 'dist'))).map(file => `dist/${file}`);
  return new Map([
    // The shipped manifest resolves shared UI inside this SDK, without workspace links.
    ['package.json', await readFile(path.join(root, 'dist/package.json'))],
    ...await Promise.all(files.map(async file => [file, await readFile(path.join(root, file))] as const)),
  ]);
}

export async function materializeAppProject(project: string, app: RuntimePluginUiReactApp, source: ReadonlyMap<string, Buffer>,
  sdk: ReadonlyMap<string, Buffer>, signal: AbortSignal): Promise<void> {
  await mkdir(project, { recursive: true });
  const prefix = `${app.root}/`;
  for (const [name, content] of source) {
    signal.throwIfAborted();
    if (!name.startsWith(prefix) || name === `${app.root}/package.json`) continue;
    await writeProjectFile(project, name.slice(prefix.length), content);
  }
  for (const [name, content] of sdk) {
    signal.throwIfAborted();
    await writeProjectFile(project, `.setsuna/sdk/${name}`, content);
  }
  await writeProjectFile(project, 'package.json', JSON.stringify(appPackageManifest(source.get(`${app.root}/package.json`)?.toString(), 'setsuna-app'), null, 2));
  await writeProjectFile(project, '.setsuna/main.tsx', appEntrySource(app, source.has(`${app.root}/styles.css`)));
  await writeProjectFile(project, '.setsuna/env.d.ts', appAssetTypes());
  await writeProjectFile(project, 'tsconfig.json', JSON.stringify({ compilerOptions: {
    target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
    strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, allowJs: true, resolveJsonModule: true,
  }, include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '.setsuna/main.tsx', '.setsuna/env.d.ts'], exclude: ['node_modules'] }, null, 2));
}

function appAssetTypes(): string {
  const urls = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot',
    'mp3', 'mp4', 'webm', 'ogg', 'wav', 'pdf', 'txt'];
  return [
    "declare module '*.module.css' { const classes: Readonly<Record<string,string>>; export default classes; }",
    "declare module '*.css' {}",
    ...urls.map(extension => `declare module '*.${extension}' { const url: string; export default url; }`),
    "declare module '*?raw' { const source: string; export default source; }",
    "declare module '*?url' { const url: string; export default url; }",
  ].join('\n');
}

export function appEntrySource(app: RuntimePluginUiReactApp, hasGlobalStyles = false): string {
  const routes = [{ path: '/*', entry: app.entry }, ...(app.routes ?? [])];
  return [
    "import React from 'react';", "import { createRoot } from 'react-dom/client';",
    "import { HashRouter, Routes, Route } from 'react-router-dom';", "import '@setsuna/app/styles.css';",
    // Root styles.css is the conventional app-wide stylesheet, including direct route opens.
    ...(hasGlobalStyles ? ["import '../styles.css';"] : []),
    ...routes.map((route, index) => `import Page${index} from ${JSON.stringify(`../${route.entry}`)};`),
    `(window as unknown as {setsunaUI:{ready:Promise<unknown>}}).setsunaUI.ready.then(() => createRoot(document.getElementById('setsuna-app-root')!).render(`,
    `<HashRouter><Routes>${routes.map((route, index) => `<Route path={${JSON.stringify(route.path)}} element={<Page${index}/>} />`).join('')}</Routes></HashRouter>));`,
  ].join('\n');
}

async function writeProjectFile(root: string, relative: string, content: string | Buffer): Promise<void> {
  const destination = path.resolve(root, relative);
  if (!pathIsInside(root, destination)) throw new Error('App project file escapes its root.');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function directoryFiles(root: string): Promise<string[]> {
  const files: string[] = []; const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(location);
      else if (entry.isFile()) files.push(path.relative(root, location).split(path.sep).join('/'));
      else throw new Error('App source and SDK may contain only regular files and directories.');
    }
  }
  return files.sort();
}
