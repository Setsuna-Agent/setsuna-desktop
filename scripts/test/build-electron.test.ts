import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeBuildOptions,
  electronMainExternals,
  runtimeExternals,
} from '../build-electron.js';

describe('electron build externals', () => {
  it('keeps node-pty external for every process that loads it', () => {
    expect(electronMainExternals).toContain('node-pty');
    expect(runtimeExternals).toContain('node-pty');
  });

  it('keeps proxy transports external to the ESM Electron main bundle', () => {
    expect(electronMainExternals).toEqual(
      expect.arrayContaining(['proxy-chain', 'undici']),
    );
  });

  it('emits a production extension worker beside the CommonJS runtime entry', () => {
    const projectRoot = path.resolve('fixture-project');
    const [runtime, worker] = createRuntimeBuildOptions(projectRoot);

    expect(runtime).toMatchObject({
      outfile: path.join(projectRoot, 'dist/runtime/cli.cjs'),
      format: 'cjs',
      define: { 'import.meta.url': '__setsunaRuntimeModuleUrl' },
    });
    expect(runtime.banner?.js).toContain('pathToFileURL(__filename)');
    expect(worker).toMatchObject({
      outfile: path.join(projectRoot, 'dist/runtime/extension-worker-entry.js'),
      format: 'esm',
    });
  });
});
