import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe.skipIf(!['darwin', 'win32'].includes(process.platform))('native renderer recovery', () => {
  it.each(['image-policy-only', 'recovery-only', 'readiness-only'])('validates %s rendering and normal fixture exit', async (scenario) => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-renderer-recovery-'));
    try {
      const entry = path.join(root, 'main.cjs');
      await build({ entryPoints: [path.resolve('apps/desktop/main/test/fixtures/renderer-recovery.ts')],
        outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
        alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') } });
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const args = [entry, root, scenario];
      const execution = promisify(execFile)(electron as unknown as string, args, {
        env, windowsHide: true, timeout: 25_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
      execution.child.once('exit', (code, signal) => console.log('Renderer recovery fixture exit', { scenario, code, signal }));
      const { stdout } = await execution.catch(error => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); });
      expect(stdout).toContain(`RENDERER_RECOVERY_OK ${scenario}`);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 35_000);
});
