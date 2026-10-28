import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createRuntimeServer } from '../../src/server/runtime-server.js';
import { InMemoryDesktopNativeBridge } from '../support/in-memory-secret-store.js';

it('keeps health readiness independent of peripheral activity reporting', async () => {
  const timings: Record<string, number> = {};
  for (const mode of ['baseline', 'slow', 'failed'] as const) {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-activity-startup-'));
    const reporter = vi.fn(mode === 'slow' ? () => new Promise<void>(() => {}) : () => { throw new Error('Peripheral unavailable'); });
    const start = performance.now();
    const server = await createRuntimeServer({ dataDir: root, token: 'test', version: 'test', nativeBridge: new InMemoryDesktopNativeBridge(), ...(mode === 'baseline' ? {} : { onActivity: reporter }) });
    try {
      await server.listen(0);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing address');
      expect((await fetch(`http://127.0.0.1:${address.port}/health`)).ok).toBe(true);
      timings[mode] = performance.now() - start;
      expect(reporter).not.toHaveBeenCalled();
    } finally {
      await server.close(); await rm(root, { recursive: true, force: true });
    }
  }
  expect(timings.slow).toBeLessThan(timings.baseline + 1000);
  expect(timings.failed).toBeLessThan(timings.baseline + 1000);
  process.stdout.write(`Activity reporting runtime-ready milliseconds: ${JSON.stringify(timings)}\n`);
});
