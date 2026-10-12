import { parseSandboxedUiSource, type RuntimePluginUiReactAppContribution, type RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import type { WorkspaceDependenciesControl } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { InstalledPluginRecord, PluginAppBuildReference } from '../../ports/plugin-bundle-store.js';
import { APP_BUILD_VERSION, appHash, appProjectSnapshot, appSdkSnapshot, materializeAppProject } from './project-files.js';
import { appCompilerEntrypoint, appProcessEnvironment, awaitAppOperation, runAppProcess } from './process.js';

/** One background build at a time; construction and capability binding never prepare a toolchain. */
export class PluginAppProjectService {
  private readonly root: string;
  private toolchain: WorkspaceDependenciesControl | undefined;
  private lifetime = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) { this.root = path.join(dataDir, 'plugin-app-projects'); }

  bindToolchain(toolchain: WorkspaceDependenciesControl): () => void {
    if (this.lifetime.signal.aborted) this.lifetime = new AbortController();
    this.toolchain = toolchain;
    return () => {
      if (this.toolchain !== toolchain) return;
      this.toolchain = undefined;
      this.lifetime.abort(new Error('Application build service is shutting down.'));
    };
  }

  async prepare(plugin: InstalledPluginRecord, signal?: AbortSignal): Promise<Readonly<Record<string, PluginAppBuildReference>>> {
    const apps = plugin.extension?.rendererUi?.contributions.filter((item): item is RuntimePluginUiReactAppContribution => Boolean(item.reactApp)) ?? [];
    if (!apps.length) return {};
    const controlled = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]);
    controlled.throwIfAborted();
    const operation = this.queue.catch(() => undefined).then(async () => {
      controlled.throwIfAborted();
      const result: Record<string, PluginAppBuildReference> = {};
      for (const app of apps) result[app.id] = await this.prepareApp(plugin, app, controlled);
      return result;
    });
    this.queue = operation;
    // Queued callers can cancel immediately, while the queue still owns cleanup of running children.
    return awaitAppOperation(operation, controlled);
  }

  async read(plugin: InstalledPluginRecord, contributionId: string): Promise<RuntimeSandboxedUiSource> {
    const reference = plugin.reactAppBuilds?.[contributionId];
    if (!reference || !/^[a-f0-9]{64}$/u.test(reference.cacheKey) || !/^[a-f0-9]{64}$/u.test(reference.sourceHash)) {
      throw new Error('This React application must be built through an approved Plugin install or update.');
    }
    const bytes = await readFile(path.join(this.pluginRoot(plugin.id), reference.cacheKey, 'source.json'));
    if (bytes.byteLength > 8 * 1024 * 1024 || appHash(bytes) !== reference.sourceHash) throw new Error('Compiled application contents have changed.');
    return parseSandboxedUiSource(JSON.parse(bytes.toString()), 'Compiled React application');
  }

  async remove(pluginId: string): Promise<void> { await rm(this.pluginRoot(pluginId), { recursive: true, force: true }); }

  async retain(plugin: Pick<InstalledPluginRecord, 'id' | 'reactAppBuilds'>): Promise<void> {
    const root = this.pluginRoot(plugin.id);
    const retained = new Set(Object.values(plugin.reactAppBuilds ?? {}).map(reference => reference.cacheKey));
    const entries = await readdir(root, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    await Promise.all(entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name) && !retained.has(entry.name))
      .map(entry => rm(path.join(root, entry.name), { recursive: true, force: true })));
  }

  private pluginRoot(id: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(id)) throw new Error('Invalid application Plugin id.');
    return path.join(this.root, id);
  }

  private async prepareApp(plugin: InstalledPluginRecord, contribution: RuntimePluginUiReactAppContribution,
    signal: AbortSignal): Promise<PluginAppBuildReference> {
    if (!this.toolchain) throw new Error('Application package toolchain is unavailable.');
    const snapshot = await appProjectSnapshot(plugin, contribution.reactApp);
    const sdk = await appSdkSnapshot();
    signal.throwIfAborted();
    const cacheKey = appHash(JSON.stringify({ version: APP_BUILD_VERSION, contributionId: contribution.id,
      bundle: snapshot.bundleHash, app: contribution.reactApp,
      sdk: [...sdk].map(([name, content]) => [name, appHash(content)]) }));
    const cache = path.join(this.pluginRoot(plugin.id), cacheKey);
    const sourcePath = path.join(cache, 'source.json');
    // Cache output is accepted only when the installed index already binds its exact bytes.
    const approved = plugin.reactAppBuilds?.[contribution.id];
    if (approved?.cacheKey === cacheKey) {
      const bytes = await readFile(sourcePath).catch(() => undefined);
      if (bytes && appHash(bytes) === approved.sourceHash) return approved;
    }
    await rm(cache, { recursive: true, force: true });
    const project = path.join(cache, 'project');
    try {
      await materializeAppProject(project, contribution.reactApp, snapshot.files, sdk, signal);
      signal.throwIfAborted();
      const toolchain = await awaitAppOperation(this.toolchain.prepareShellToolchain({ command: 'pnpm install',
        environment: { id: `plugin-app-${plugin.id}`, cwd: project, workspaceRoot: project, workspaceRoots: [project] } }), signal);
      signal.throwIfAborted();
      const environment = appProcessEnvironment(toolchain.environment);
      const require = createRequire(import.meta.url);
      const corepack = path.join(path.dirname(require.resolve('corepack/package.json')), 'dist/pnpm.js');
      await runAppProcess([corepack, 'install', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--reporter=append-only'],
        project, environment, signal);
      // Vite transpiles TSX without checking component props or cross-file types.
      // Fail the staged install before publishing a page with an invalid SDK call.
      const projectRequire = createRequire(path.join(project, 'package.json'));
      await runAppProcess([projectRequire.resolve('typescript/lib/tsc.js'), '--project', project, '--noEmit', '--pretty', 'false'],
        project, environment, signal);
      const worker = appCompilerEntrypoint();
      const message = await runAppProcess([...worker.execArgv, worker.path, project], project, environment, signal, true) as {
        ok?: boolean; source?: unknown; error?: string;
      } | undefined;
      if (!message?.ok || !message.source) throw new Error(message?.error ?? 'Application compiler returned no page.');
      const source = parseSandboxedUiSource(message.source, 'Compiled React application');
      const bytes = Buffer.from(JSON.stringify(source));
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Compiled application exceeds the page limit.');
      signal.throwIfAborted();
      await mkdir(cache, { recursive: true });
      await writeFile(sourcePath, bytes);
      signal.throwIfAborted();
      return { cacheKey, sourceHash: appHash(bytes) };
    } catch (error) {
      await rm(cache, { recursive: true, force: true });
      throw error;
    }
  }
}
