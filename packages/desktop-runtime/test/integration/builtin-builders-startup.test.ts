import type { RuntimePluginMarketplaceList } from '@setsuna-desktop/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { FilePluginMarketplace } from '../../src/adapters/plugin/file-plugin-marketplace.js';
import { createRuntimeServer } from '../../src/server/runtime-server.js';
import { InMemoryDesktopNativeBridge } from '../support/in-memory-secret-store.js';

it('keeps core readiness independent of builder sync and cancels late installation on shutdown', async () => {
  const timings: Record<string, number> = {};
  for (const mode of ['baseline', 'slow', 'failed'] as const) {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-builder-startup-'));
    let releaseCatalog!: (catalog: RuntimePluginMarketplaceList) => void;
    const pendingCatalog = new Promise<RuntimePluginMarketplaceList>((resolve) => { releaseCatalog = resolve; });
    const listing = vi.spyOn(FilePluginMarketplace.prototype, 'listPlugins');
    const install = vi.spyOn(FilePluginMarketplace.prototype, 'installPlugin');
    if (mode === 'baseline') listing.mockResolvedValue({ plugins: [], errors: [] });
    if (mode === 'slow') listing.mockReturnValue(pendingCatalog);
    if (mode === 'failed') listing.mockRejectedValue(new Error('Bundled catalog unavailable'));
    const started = performance.now();
    try {
      const server = await createRuntimeServer({ dataDir: root, token: 'test', version: 'test', nativeBridge: new InMemoryDesktopNativeBridge() });
      try {
        await server.listen(0);
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing runtime address');
        const origin = `http://127.0.0.1:${address.port}`;
        expect((await fetch(`${origin}/health`)).ok).toBe(true);
        expect((await fetch(`${origin}/v1/threads`, { headers: { authorization: 'Bearer test' } })).ok).toBe(true);
        timings[mode] = performance.now() - started;
        expect(listing).toHaveBeenCalledOnce();
      } finally { await server.close(); }
      expect(listing.mock.calls[0][0]?.signal?.aborted).toBe(true);
      if (mode === 'slow') {
        releaseCatalog({ plugins: [{
          id: 'plugin-builder', name: 'Plugin Builder', installed: false, updateAvailable: false,
          featured: false, tags: [], skills: [], mcpServers: [], hooks: [], resources: [],
          capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
        }], errors: [] });
        await pendingCatalog;
        await setImmediate();
        expect(install).not.toHaveBeenCalled();
      }
    } finally {
      listing.mockRestore();
      install.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }
  expect(timings.slow).toBeLessThan(timings.baseline + 1000);
  expect(timings.failed).toBeLessThan(timings.baseline + 1000);
  process.stdout.write(`Builder sync runtime-ready milliseconds: ${JSON.stringify(timings)}\n`);
});
