import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createElectronBuildOptions, createRuntimeBuildOptions } from '../build-electron.js';
import { watchElectronDev } from '../watch-electron-dev.js';

it('loads Feature sources and publishes a shared change only when both Electron and runtime can use it', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'setsuna-dev-watch-')));
  const reload = vi.fn();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const save = async (file: string, source: string) => {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  };
  const run = (file: string) => execFileSync(process.execPath, [join(root, file)], { encoding: 'utf8' }).trim();
  const shared = 'packages/contracts/src/index.ts';
  const feature = 'packages/features/example/src/runtime/index.ts';
  const runtime = 'dist/runtime/cli.cjs';
  const main = 'dist/electron/main/index.js';
  let watcher: Awaited<ReturnType<typeof watchElectronDev>> | undefined;
  try {
    for (const build of [...createElectronBuildOptions(root), ...createRuntimeBuildOptions(root)]) {
      for (const entry of build.entryPoints as string[]) {
        await mkdir(dirname(entry), { recursive: true });
        await writeFile(entry, entry.endsWith('.json') ? '{}' : '');
      }
    }
    await mkdir(join(root, 'packages/feature-core/src'), { recursive: true });
    await save(shared, 'export const version = 1, suffix = "v1";');
    await save(feature, 'export const name = "first";');
    await save('apps/desktop/main/src/index.ts', 'import { version } from "@setsuna-desktop/contracts"; console.log(version);');
    await save('packages/desktop-runtime/src/cli.ts', `
      import { suffix } from '@setsuna-desktop/contracts';
      import { name } from '@setsuna-desktop/feature-example/runtime';
      console.log(name, suffix);
    `);
    watcher = await watchElectronDev(root, reload);
    await watcher.ready;
    expect(run(runtime)).toBe('first v1');

    await save(feature, 'export const name = "edited";');
    await vi.waitFor(() => expect(reload.mock.calls).toEqual([['restart-runtime']]), { timeout: 5_000 });
    expect(run(runtime)).toBe('edited v1');

    // Main builds with the new version, but runtime still needs the missing export.
    await save(shared, 'export const version = 2;');
    await vi.waitFor(() => expect(warning).toHaveBeenCalled(), { timeout: 5_000 });
    expect(run(main)).toBe('1');
    expect(run(runtime)).toBe('edited v1');
    expect(reload).toHaveBeenCalledTimes(1);

    await save(shared, 'export const version = 2, suffix = "v2";');
    await vi.waitFor(() => expect(reload.mock.calls).toEqual([['restart-runtime'], ['relaunch-electron']]), { timeout: 5_000 });
    expect(run(main)).toBe('2');
    expect(run(runtime)).toBe('edited v2');

    const preset = 'beui.design.json';
    await save(`packages/features/design/src/resources/design-libraries/${preset}`, '{"updated":true}');
    await vi.waitFor(() => expect(reload.mock.calls.at(-1)).toEqual(['restart-runtime']), { timeout: 5_000 });
    await expect(readFile(join(root, 'dist', 'resources', 'design-libraries', preset), 'utf8')).resolves.toBe('{"updated":true}');
  } finally {
    await watcher?.dispose();
    warning.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
