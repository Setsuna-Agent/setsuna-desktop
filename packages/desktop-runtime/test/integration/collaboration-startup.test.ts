import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { RuntimeCollaborationCoordinator } from '@setsuna-desktop/feature-collaboration/runtime';
import { createRuntimeServer } from '../../src/server/runtime-server.js';
import { InMemoryDesktopNativeBridge } from '../support/in-memory-secret-store.js';
import { AgentLoop } from '../../src/loop/core/agent-loop.js';

it('keeps runtime health ready independent of slow or failed collaboration reconciliation', async () => {
  const timings: Record<string, number> = {};
  for (const mode of ['baseline', 'slow', 'failed'] as const) {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-collaboration-startup-'));
    const reconcile = vi.spyOn(RuntimeCollaborationCoordinator.prototype, 'reconcileInterruptedTasks');
    const originalHost = AgentLoop.prototype.collaborationRuntimeHost;
    const listModels = vi.fn(() => mode === 'slow' ? new Promise<never>(() => {})
      : mode === 'failed' ? Promise.reject(new Error('Model catalog unavailable')) : Promise.resolve([]));
    const host = vi.spyOn(AgentLoop.prototype, 'collaborationRuntimeHost').mockImplementation(function (this: AgentLoop) {
      return { ...originalHost.call(this), listModels };
    });
    if (mode === 'slow') reconcile.mockImplementation(() => new Promise<void>(() => {}));
    if (mode === 'failed') reconcile.mockRejectedValue(new Error('Projection unavailable'));
    const started = performance.now();
    try {
      const server = await createRuntimeServer({ dataDir: root, token: 'test', version: 'test', nativeBridge: new InMemoryDesktopNativeBridge() });
      try {
        await server.listen(0);
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing address');
        expect((await fetch(`http://127.0.0.1:${address.port}/health`)).ok).toBe(true);
        timings[mode] = performance.now() - started;
        expect(reconcile).not.toHaveBeenCalled();
        expect(listModels).not.toHaveBeenCalled();
      } finally { await server.close(); }
    } finally { reconcile.mockRestore(); host.mockRestore(); await rm(root, { recursive: true, force: true }); }
  }
  expect(timings.slow).toBeLessThan(timings.baseline + 1000);
  expect(timings.failed).toBeLessThan(timings.baseline + 1000);
  process.stdout.write(`Collaboration runtime-ready milliseconds: ${JSON.stringify(timings)}\n`);
});
