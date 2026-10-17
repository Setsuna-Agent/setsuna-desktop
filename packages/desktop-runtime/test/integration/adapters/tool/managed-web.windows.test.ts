import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { ShellToolchain } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { createHost, stubWorkspaceDependencyManager } from './pc-local-tool-host.support.js';

const execFileAsync = promisify(execFile);
const fixtureFile = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const context = { threadId: 'thread_1', turnId: 'web_1', permissionProfile: 'danger-full-access' as const };

describe.skipIf(process.platform !== 'win32')('Windows managed web development', () => {
  it('uses the selected Node from an Electron runtime and serves Vite without a new console', async () => {
    let toolchain: ShellToolchain;
    const fixture = await createHost({
      workspaceDependencies: stubWorkspaceDependencyManager({ prepareShellToolchain: async () => toolchain }),
    });
    const { host, projectDir, fixtureRoot } = fixture;
    onTestFinished(async () => {
      await host.shutdown();
      await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    });
    await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({
      private: true, packageManager: 'pnpm@7.33.7', scripts: { dev: `node "${fixtureFile('managed-vite.mjs')}"` },
    }));
    await writeFile(path.join(projectDir, 'index.html'), '<p>managed web regression</p>');
    const dataDir = path.join(fixtureRoot, 'runtime');
    // Reuse the package manager that is running this repository test script;
    // the isolated Corepack cache never needs a network download.
    await seedPnpmCache(dataDir);
    const output = path.join(fixtureRoot, 'toolchain.json');
    const input = path.join(fixtureRoot, 'input.json');
    await writeFile(input, JSON.stringify({ dataDir, projectDir, output }));
    const electron = path.resolve('node_modules/electron/dist/electron.exe');
    await execFileAsync(electron, [
      '--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href,
      fixtureFile('prepare-workspace-toolchain.ts'), input,
    ], {
      windowsHide: true, timeout: 20_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: [
        path.resolve('node_modules/.bin'), path.dirname(process.execPath), process.env.PATH,
      ].join(path.delimiter) },
    });
    const prepared = JSON.parse(await readFile(output, 'utf8')) as { runtime: string; toolchain: ShellToolchain };
    expect(path.basename(prepared.runtime)).toBe('electron.exe');
    toolchain = prepared.toolchain;
    const result = await host.runTool('exec_command', { cmd: 'pnpm dev', persist: true, yield_time_ms: 1 }, context);
    const id = (result.data as { process_id: string }).process_id;
    const readReady = () => readFile(path.join(projectDir, 'web.json'), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
    await expect.poll(readReady, { timeout: 20_000 }).toBeTruthy();
    const ready = await readReady() as { pid: number; executable: string; electronNode: string | null; url: string };
    expect(ready.executable.toLowerCase()).toBe(process.execPath.toLowerCase());
    expect.soft(ready.electronNode).toBeNull();
    expect(await fetch(ready.url).then((response) => response.text())).toContain('managed web regression');
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File', fixtureFile('console-state.ps1'), '-TargetProcessId', String(ready.pid),
    ], { windowsHide: true, timeout: 10_000 });
    // Windows Terminal has a separate presentation HWND; IsWindowVisible on
    // GetConsoleWindow alone can miss it. A windowless console has no HWND.
    expect(JSON.parse(stdout)).toMatchObject({ window: '0', processes: expect.arrayContaining([ready.pid]) });
    await host.cleanupTurn(context, { status: 'completed' });
    expect((await host.runTool('read_shell_process', { process_id: id }, { ...context, turnId: 'web_2' })).data).toMatchObject({ running: true });
    await host.terminateBackgroundShellProcess(context.threadId, id);
    await expect.poll(() => fetch(ready.url).then(() => true).catch(() => false)).toBe(false);
  });
});

async function seedPnpmCache(dataDir: string): Promise<void> {
  const entry = process.env.npm_execpath;
  if (!entry) throw new Error('Run this test through the repository pnpm test:integration script.');
  const source = path.resolve(path.dirname(entry), '..');
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  expect(manifest).toMatchObject({ name: 'pnpm', version: '7.33.7' });
  const cache = path.join(dataDir, 'workspace-dependencies/cache/corepack/v1/pnpm/7.33.7');
  await mkdir(cache, { recursive: true });
  for (const directory of ['bin', 'dist']) {
    await symlink(path.join(source, directory), path.join(cache, directory), 'junction');
  }
  await writeFile(path.join(cache, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(cache, '.corepack'), JSON.stringify({
    locator: { name: 'pnpm', reference: '7.33.7' }, bin: manifest.bin, hash: 'sha512.local-test-fixture',
  }));
}
