import { ManagedWorkspaceDependencyManager } from '@setsuna-desktop/feature-workspace-dependencies/runtime';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { createRuntimeServer } from '../../src/server/runtime-server.js';
import { InMemoryDesktopNativeBridge } from '../support/in-memory-secret-store.js';
import { createPluginFixture, createPluginRuntime, patchPluginManifest } from '../adapters/plugin/support/file-plugin-bundle-store-fixture.js';

it('reaches runtime health with an installed React app even when package preparation hangs or fails', async () => {
  const { root, bundleDir } = await createPluginFixture();
  const runtime = await createPluginRuntime(root);
  const prepare = vi.spyOn(ManagedWorkspaceDependencyManager.prototype, 'prepareShellToolchain');
  const timings: Record<string, number> = {};
  try {
    await mkdir(path.join(bundleDir, 'app')); await mkdir(path.join(bundleDir, 'extension'));
    await writeFile(path.join(bundleDir, 'app/Home.tsx'), 'export default () => <main/>');
    await writeFile(path.join(bundleDir, 'extension/entry.mjs'), 'export default () => {}');
    await patchPluginManifest(bundleDir, { schemaVersion: 2, id: 'startup-app', skills: [], tools: [], hooks: [], mcpServers: [], resources: [],
      extension: { apiVersion: 1, runtime: 'node-worker', entry: 'extension/entry.mjs', capabilities: ['ui'], rendererUi: {
        schemaVersion: 2, actions: [], contributions: [{ id:'app.page', slot:'renderer.plugin.page', navigation:{label:'App'},
          reactApp: {root:'app', entry:'Home.tsx', actionIds:[]} }],
      } },
    });
    for (const mode of ['baseline', 'hung', 'failed'] as const) {
      if (mode === 'hung') {
        await runtime.plugins.installPlugin({ path: bundleDir });
        // Model a trusted installed app whose cache was removed: startup must never rebuild it.
        const indexPath = path.join(runtime.dataDir, 'plugins.json');
        const index = JSON.parse(await readFile(indexPath, 'utf8'));
        const installed = index.plugins.find((plugin: { id: string }) => plugin.id === 'startup-app');
        installed.extension.trustedHash = installed.extension.bundleHash;
        await writeFile(indexPath, JSON.stringify(index));
        prepare.mockImplementation(() => new Promise<never>(() => {}));
      } else if (mode === 'failed') prepare.mockRejectedValue(new Error('Toolchain unavailable'));
      const started = performance.now();
      const server = await createRuntimeServer({ dataDir: root, token: 'startup-test', version: 'test', nativeBridge: new InMemoryDesktopNativeBridge() });
      try {
        await server.listen(0); const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Runtime has no address');
        expect((await fetch(`http://127.0.0.1:${address.port}/health`)).ok).toBe(true);
        timings[mode] = performance.now() - started;
        expect(prepare).not.toHaveBeenCalled();
        await expect(stat(path.join(runtime.dataDir, 'plugin-app-projects'))).rejects.toThrow();
      } finally { await server.close(); }
    }
    expect(timings.hung).toBeLessThan(timings.baseline + 1000);
    expect(timings.failed).toBeLessThan(timings.baseline + 1000);
    process.stdout.write('React app runtime readiness (ms): ' + JSON.stringify(Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Math.round(value)]))) + '\n');
  } finally { prepare.mockRestore(); await rm(root, {recursive:true, force:true}); }
});
