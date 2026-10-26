import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeBuildOptions } from '../build-electron.js';

describe('tool program production bundle', () => {
  it('runs the production bundle with embedded WASM and no sibling assets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-program-bundle-'));
    const outfile = path.join(root, 'tool-program-worker.cjs');
    let worker: Worker | undefined;
    const snapshots: [string, string][][] = [];
    try {
      const options = createRuntimeBuildOptions(process.cwd()).find(option => option.outfile?.endsWith('tool-program-worker.cjs'))!;
      await build({ ...options, outfile, sourcemap: false });
      worker = new Worker(outfile);
      const output = new Promise<string>((resolve, reject) => {
        worker!.once('error', reject);
        worker!.on('message', message => {
          if (message.type === 'state') snapshots.push(message.values);
          if (message.type === 'done') resolve(message.output);
          else if (message.type === 'error') reject(new Error(message.error));
        });
      });
      worker.postMessage({ type: 'start', code: 'for (let i = 0; i < 2000; i++) store("answer", 6 * 7); text(load("answer"));', toolNames: [] });
      expect(await output).toBe('42');
      expect(snapshots).toEqual([[['answer', '42']]]);
    } finally { await worker?.terminate(); await rm(root, { recursive: true, force: true }); }
  });
});
