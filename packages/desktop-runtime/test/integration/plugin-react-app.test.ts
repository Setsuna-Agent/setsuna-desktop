import type { RuntimePluginUiActionInput, RuntimePluginUiDataValue, RuntimePluginUiRuntimeRequest } from '@setsuna-desktop/contracts';
import type { WorkspaceDependenciesControl } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';
import { ExtensionManager } from '../../src/extensions/extension-manager.js';
import { buildAppProject } from '../../src/adapters/plugin-app/vite-build.js';
import { createPluginFixture, createPluginRuntime, patchPluginManifest } from '../adapters/plugin/support/file-plugin-bundle-store-fixture.js';
import { verifyPackagedAppCompiler } from '../support/plugin-app-compiler-package.js';

const require = createRequire(import.meta.url);
const context = { contributionId: 'notes.page', surface: 'renderer.plugin.page' as const };

// Budget real package installs, ASAR compilation and one failed/successful update.
// Individual production builds still retain their own 180 s timeout.
const appLifecycleTimeoutMs = 240_000;

it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('installs a multi-file React app with packages, routes and the existing state/action bridge; reopens from cache and preserves a failed update', async () => {
  const { root, bundleDir } = await createPluginFixture();
  const runtime = await createPluginRuntime(root);
  const prepareToolchain = async () => ({ environment: { npm_config_prefer_offline: 'true' }, commands: {}, readableRoots: [], writableCacheRoots: [] });
  const prepare = vi.fn(prepareToolchain);
  const unbind = runtime.plugins.bindAppToolchain({ prepareShellToolchain: prepare } as unknown as WorkspaceDependenciesControl);
  const manager = new ExtensionManager(runtime.plugins, runtime.extensionState, { handle: async () => null }, {
    workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
    workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
    runtimeApi: { request: async () => ({ ok: true, status: 200, data: { projects: [{ id: 'project-real' }] } }) },
  });
  runtime.plugins.setRuntimeMutationCoordinator(manager);
  let server: ReturnType<typeof createServer> | undefined;
  try {
    // The SDK is a shipped build artifact, prepared by the repository's declared build script.
    const pnpm = path.join(path.dirname(require.resolve('corepack/package.json')), 'dist/pnpm.js');
    await promisify(execFile)(process.execPath, [pnpm, 'build:app-sdk'], { cwd: process.cwd(), windowsHide: true });
    const appRoot = path.join(bundleDir, 'apps/notes');
    await mkdir(path.join(appRoot, 'pages'), { recursive: true });
    await mkdir(path.join(appRoot, 'components'), { recursive: true });
    const devDependencies = {
      typescript: require('typescript/package.json').version,
      '@types/react': require('@types/react/package.json').version,
      '@types/react-dom': require('@types/react-dom/package.json').version,
    };
    await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ dependencies: { zod: '4.4.3' }, devDependencies,
      scripts: { postinstall: 'node install-hook.mjs' } }));
    const statsRoot = path.join(bundleDir, 'apps/stats'); await mkdir(statsRoot, { recursive: true });
    await writeFile(path.join(statsRoot, 'package.json'), JSON.stringify({ devDependencies }));
    // This page proves project/package isolation; shared UI is exercised by the notes app.
    await writeFile(path.join(statsRoot, 'App.tsx'), 'export default () => <main>Independent stats app</main>');
    await writeFile(path.join(appRoot, 'install-hook.mjs'), 'throw new Error("Lifecycle scripts must not execute")');
    await writeFile(path.join(appRoot, 'vite.config.js'), 'throw new Error("App-owned Vite configuration must not execute")');
    await writeFile(path.join(appRoot, 'postcss.config.js'), 'throw new Error("App-owned PostCSS configuration must not execute")');
    await writeFile(path.join(appRoot, '.env'), 'VITE_PRIVATE_TOKEN=private-build-value');
    await writeFile(path.join(appRoot, 'components/Count.tsx'), 'export default function Count({value}:{value:number}) { return <output id="count">{value}</output> }');
    const home = `import {useEffect,useState} from 'react';
      import {Button, TextField, AppLayout, Link, invokeAction, useAppData} from '@setsuna/app';
      import {z} from 'zod'; import Count from '../components/Count'; import '../style.css';
      export default function Home() {
        const data = useAppData<{count?:number}>(); const [value, setValue] = useState('');
        useEffect(() => setValue(''), [data]);
        return <AppLayout><Count value={data.count ?? 0}/>
          <form onSubmit={async event => {
          event.preventDefault(); await invokeAction('notes.save', {value:z.string().min(1).parse(value)});
        }}><TextField aria-label="Note" name="note" value={value} onChange={event => setValue(event.target.value)} required/>
          <Button type="submit">Save</Button></form><Link to="/detail/42">Detail</Link></AppLayout>
      }`;
    await writeFile(path.join(appRoot, 'pages/Home.tsx'), home);
    await writeFile(path.join(appRoot, 'pages/Detail.tsx'), `import {useParams, Link, useAppData} from '@setsuna/app';
      export default function Detail(){ const {id} = useParams(); const data = useAppData<{count:number}>();
        return <main><output id="route">{id}</output><output id="saved">{data.count}</output><Link to="/">Home</Link></main> }`);
    await writeFile(path.join(appRoot, 'style.css'), '.notes {display:grid}');
    await mkdir(path.join(bundleDir, 'extension'), { recursive: true });
    await writeFile(path.join(bundleDir, 'extension/entry.mjs'), `export default function activate(api) {
      api.onUiAction('notes.hidden', async () => { throw new Error('This contribution must not invoke hidden actions'); });
      api.onUiAction('notes.save', async (input, context) => {
        if (typeof input.payload?.value !== 'string') throw new Error('Invalid note');
        const view = await context.state.get('view') ?? {count:0};
        await context.state.set('view', {count:view.count + 1, value:input.payload.value});
      });
    }`);
    await patchPluginManifest(bundleDir, { schemaVersion: 2, id: 'react-notes', tools: [], skills: [], hooks: [], mcpServers: [], resources: [],
      extension: { apiVersion: 1, runtime: 'node-worker', entry: 'extension/entry.mjs', capabilities: ['ui', 'state'],
        rendererUi: { schemaVersion: 2, actions: [{ id: 'notes.save' }, { id: 'notes.hidden' }], contributions: [{
          id: 'notes.page', slot: 'renderer.plugin.page', navigation: { label: 'Notes' }, data: { stateKey: 'view', scope: 'global' },
          reactApp: { root: 'apps/notes', entry: 'pages/Home.tsx', routes: [{path:'/detail/:id', entry:'pages/Detail.tsx'}], actionIds: ['notes.save'] },
        }, { id:'stats.page', slot:'renderer.plugin.page', navigation:{label:'Stats'},
          reactApp: {root:'apps/stats', entry:'App.tsx', actionIds:[]} }] } },
    });
    const installed = await runtime.plugins.installPlugin({ path: bundleDir }, { trustExtension: true });
    expect(installed.plugin).not.toHaveProperty('reactAppBuilds');
    const source = await runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page');
    expect(source.js).not.toContain('private-build-value');
    const [record] = await runtime.plugins.listInstalledRecords();
    const reference = record.reactAppBuilds!['notes.page'];
    const cache = path.join(runtime.dataDir, 'plugin-app-projects/react-notes', reference.cacheKey);
    const project = path.join(cache, 'project');
    const statsCache = path.join(path.dirname(cache), record.reactAppBuilds!['stats.page'].cacheKey);
    expect(statsCache).not.toBe(cache);
    const statsSource = await runtime.plugins.readTrustedRendererUiDocument('react-notes', 'stats.page');
    expect(statsSource.js).toContain('Independent stats app');
    await expect(readFile(path.join(statsCache, 'project/node_modules/zod/package.json'))).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(project, 'node_modules/zod/package.json'), 'utf8')).name).toBe('zod');
    // A minimal real app covers ASAR/ESM/native dependencies without recompiling all SDK widgets.
    await verifyPackagedAppCompiler(root, path.join(statsCache, 'project'));
    // Identical updates must reuse both approved pages, even when package preparation is unavailable.
    const preparedBeforeUpdate = prepare.mock.calls.length;
    const validateActivation = vi.spyOn(manager, 'validatePluginActivation');
    prepare.mockRejectedValue(new Error('Package toolchain unavailable'));
    try {
      await runtime.plugins.updatePlugin({ path: bundleDir }, { trustExtension: true });
      for (const failure of ['failed activation', 'cancelled update']) {
        const controller = new AbortController();
        validateActivation.mockImplementationOnce(async () => {
          if (failure === 'cancelled update') controller.abort(new Error(failure));
          else throw new Error(failure);
        });
        await expect(runtime.plugins.updatePlugin({ path: bundleDir }, {
          trustExtension: true, signal: controller.signal,
        })).rejects.toThrow(failure);
        await expect(runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page')).resolves.toEqual(source);
        await expect(runtime.plugins.readTrustedRendererUiDocument('react-notes', 'stats.page')).resolves.toEqual(statsSource);
        expect((await runtime.plugins.listInstalledRecords())[0].reactAppBuilds).toEqual(record.reactAppBuilds);
      }
      expect(prepare).toHaveBeenCalledTimes(preparedBeforeUpdate);
    } finally {
      validateActivation.mockRestore();
      prepare.mockImplementation(prepareToolchain);
    }
    const action = (actionId: string, payload: Record<string, RuntimePluginUiDataValue>): RuntimePluginUiActionInput => ({
      pluginId: 'react-notes', actionId, values: {}, payload, context,
    });
    await expect(manager.runRendererUiAction(action('notes.hidden', {}))).rejects.toThrow('not allowed');
    server = createServer((request, response) => {
      void (async () => {
        let body = ''; for await (const chunk of request) body += chunk;
        const input = body ? JSON.parse(body) : {};
        if (request.url === '/action') await manager.runRendererUiAction(action(input.actionId, input.payload));
        const result = request.url === '/runtime'
          ? await manager.requestRuntimeApi({ pluginId: 'react-notes', contributionId: 'notes.page', request: input } as RuntimePluginUiRuntimeRequest)
          : await manager.readRendererUiData({ pluginId: 'react-notes', context });
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
      })().catch(error => { console.error(error); response.writeHead(500); response.end(String(error)); });
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test bridge');
    const native = path.join(root, 'native'); await mkdir(native);
    await writeFile(path.join(native, 'source.json'), JSON.stringify(source));
    await build({ entryPoints: { main: 'apps/desktop/main/test/fixtures/plugin-react-app.ts', preload: 'apps/desktop/main/test/fixtures/plugin-ui-page.preload.ts' },
      outdir: native, outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs', bundle: true, external: ['electron'],
      alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') } });
    await build({ entryPoints: ['apps/desktop/renderer/test/fixtures/plugin-react-app.tsx'], outfile: path.join(native, 'frame.js'),
      platform: 'browser', format: 'iife', bundle: true, jsx: 'automatic', loader: { '.css': 'empty' },
      alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron as unknown as string,
      [path.join(native, 'main.cjs'), native, `http://127.0.0.1:${address.port}`], { env, windowsHide: true, timeout: 30_000 });
    expect(result.stdout).toContain('PLUGIN_REACT_APP_PASSED');
    expect(await runtime.extensionState.get('react-notes', 'global', 'view')).toEqual({ count: 1, value: 'Shared note' });
    const preparedBeforeOpen = prepare.mock.calls.length;
    unbind();
    await expect(runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page')).resolves.toEqual(source);
    expect(prepare).toHaveBeenCalledTimes(preparedBeforeOpen);
    const changed = Buffer.from(JSON.stringify({ ...source, js: 'tampered' }));
    const original = await readFile(path.join(cache, 'source.json'));
    await writeFile(path.join(cache, 'source.json'), changed);
    await expect(runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page')).rejects.toThrow('changed');
    await writeFile(path.join(cache, 'source.json'), original);
    runtime.plugins.bindAppToolchain({ prepareShellToolchain: prepare } as unknown as WorkspaceDependenciesControl);
    // One type-invalid update proves both SDK typechecking and rollback of a populated app.
    await writeFile(path.join(appRoot, 'pages/Home.tsx'), "import {Button} from '@setsuna/app'; export default () => <Button variant='icon'/>");
    await expect(runtime.plugins.updatePlugin({ path: bundleDir }, { trustExtension: true })).rejects.toThrow('TS2322');
    await expect(runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page')).resolves.toEqual(source);
    expect(await runtime.extensionState.get('react-notes', 'global', 'view')).toMatchObject({ count: 1 });
    expect((await readdir(path.dirname(cache))).sort()).toEqual(Object.values(record.reactAppBuilds!).map(build => build.cacheKey).sort());
    // An actual Vite build must reject imports of files outside this app's own project.
    const privateFile = path.join(root, 'private.txt'); await writeFile(privateFile, 'private-file-content');
    await writeFile(path.join(project, '.setsuna/main.tsx'), `import value from ${JSON.stringify(privateFile + '?raw')}; console.log(value)`);
    await expect(buildAppProject(project)).rejects.toThrow('must stay inside');
    await writeFile(path.join(root, 'private.css'), '.private { color: red }');
    await writeFile(path.join(project, '.setsuna/main.tsx'), "import '../outside.css'");
    for (const css of [`@import ${JSON.stringify(path.join(root, 'private.css'))};`, `.private {background:url(${JSON.stringify(privateFile)})}`]) {
      await writeFile(path.join(project, 'outside.css'), css);
      await expect(buildAppProject(project)).rejects.toThrow('must stay inside');
    }
    // Cache replacement and state retention do not need another build of every SDK control.
    await writeFile(path.join(appRoot, 'pages/Home.tsx'), 'export default () => <main>Updated notes app</main>');
    await runtime.plugins.updatePlugin({ path: bundleDir }, { trustExtension: true });
    expect((await runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page')).js).toContain('Updated notes app');
    const [updated] = await runtime.plugins.listInstalledRecords();
    expect(updated.reactAppBuilds!['notes.page'].cacheKey).not.toBe(reference.cacheKey);
    expect((await readdir(path.dirname(cache))).sort()).toEqual(Object.values(updated.reactAppBuilds!).map(build => build.cacheKey).sort());
    expect(await runtime.extensionState.get('react-notes', 'global', 'view')).toMatchObject({ count: 1 });
    await runtime.plugins.setExtensionTrust('react-notes', false);
    await expect(runtime.plugins.readTrustedRendererUiDocument('react-notes', 'notes.page')).rejects.toThrow('not trusted');
    await expect(manager.requestRuntimeApi({ pluginId: 'react-notes', contributionId: 'notes.page', request: { path: '/v1/projects' } })).rejects.toThrow('not trusted');
    await runtime.plugins.removePlugin('react-notes');
    await expect(readdir(path.dirname(cache))).rejects.toThrow();
  } finally {
    unbind(); await manager.shutdown();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, appLifecycleTimeoutMs);
