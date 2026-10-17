import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { windowsShellProvider } from '../../../support/windows-shell-provider.js';
import { createHost, nodeCommand } from './pc-local-tool-host.support.js';

const execFileAsync = promisify(execFile);
const context = { threadId: 'thread_1', turnId: 'managed_1', permissionProfile: 'danger-full-access' as const };

describe.skipIf(process.platform !== 'win32')('Windows managed shell execution', () => {
  async function fixture() {
    const fixture = await createHost();
    onTestFinished(async () => {
      await fixture.host.shutdown();
      await rm(fixture.fixtureRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    });
    return fixture;
  }

  it('uses the managed launcher for a bypass plan even with a restricted permission profile', async () => {
    const { host, projectDir } = await fixture();
    const provider = windowsShellProvider()!;
    const managedCommand = vi.fn(provider.managedCommand);
    host.bindShellSandboxProvider({ ...provider, managedCommand });
    const result = await host.runTool('exec_command', { cmd: 'echo host>marker.txt', yield_time_ms: 0 }, {
      ...context, permissionProfile: 'workspace-write', sandbox: { mode: 'bypass' },
    });
    expect(result.content).toContain('Sandbox: bypass');
    expect(managedCommand).toHaveBeenCalledOnce();
    expect(await readFile(path.join(projectDir, 'marker.txt'), 'utf8')).toContain('host');
  });

  it.each(['missing', 'failed'] as const)('does not directly launch a host command when management is %s', async (mode) => {
    const { host, projectDir } = await fixture();
    const provider = windowsShellProvider()!;
    host.bindShellSandboxProvider({
      ...provider,
      managedCommand: mode === 'missing' ? undefined : () => ({ command: path.join(projectDir, 'missing-helper.exe'), args: [] }),
    });
    await expect(host.runTool('exec_command', { cmd: 'echo escaped>escaped.txt', yield_time_ms: 0 }, context)).rejects.toThrow();
    expect(existsSync(path.join(projectDir, 'escaped.txt'))).toBe(false);
  });

  it('never uses the host launcher when the actual provider is windows-native', async () => {
    const { host } = await fixture();
    const provider = windowsShellProvider()!;
    const managedCommand = vi.fn(provider.managedCommand);
    const writeRequest = vi.fn(async () => { throw new Error('sandbox preparation failed'); });
    host.bindShellSandboxProvider({
      ...provider, managedCommand, writeRequest,
      capability: () => ({ supported: true, provider: 'windows-native', reason: '', executablePath: process.env.SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH }),
    });
    await expect(host.runTool('exec_command', { cmd: 'echo restricted', yield_time_ms: 0 }, {
      ...context, permissionProfile: 'workspace-write',
    })).rejects.toThrow('sandbox preparation failed');
    expect(writeRequest).toHaveBeenCalledOnce();
    expect(managedCommand).not.toHaveBeenCalled();
  });

  it('keeps an orphaned descendant across turns and stops it through the Run Center entrypoint', async () => {
    const { host, projectDir } = await fixture();
    const marker = path.join(projectDir, 'descendant.json');
    await writeFile(path.join(projectDir, 'child.cjs'), [
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid }));`,
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    await writeFile(path.join(projectDir, 'parent.cjs'), [
      "const log = require('node:fs').openSync('child.log', 'w');",
      // Node's own Windows child job would otherwise terminate this child at exit.
      // Detached skips that ownership; the outer native Job must still contain it.
      "const child = require('node:child_process').spawn(process.execPath, ['child.cjs'], { detached: true, stdio: ['ignore', log, log], windowsHide: true });",
      'child.unref();',
      "require('node:fs').writeFileSync('root.pid', String(process.pid));",
      'process.exit(23);',
    ].join('\n'));
    const result = await host.runTool('exec_command', { cmd: `${nodeCommand()} parent.cjs`, persist: true, yield_time_ms: 1 }, context);
    const id = (result.data as { process_id: string }).process_id;
    try {
      await expect.poll(() => existsSync(marker), { timeout: 5_000 }).toBe(true);
    } catch {
      const status = await host.runTool('read_shell_process', { process_id: id }, context).catch((error: Error) => ({ content: error.message }));
      throw new Error(`${status.content}\n${await readFile(path.join(projectDir, 'child.log'), 'utf8').catch(String)}`);
    }
    const { pid } = JSON.parse(await readFile(marker, 'utf8')) as { pid: number };
    const rootPid = Number(await readFile(path.join(projectDir, 'root.pid'), 'utf8'));
    await expect.poll(() => processAlive(rootPid)).toBe(false);
    await host.cleanupTurn(context, { status: 'completed' });
    const status = await host.runTool('read_shell_process', { process_id: id }, { ...context, turnId: 'managed_2' });
    expect(status.data).toMatchObject({ running: true, persisted: true });
    expect(processAlive(pid)).toBe(true);
    expect(await host.terminateBackgroundShellProcess(context.threadId, id)).toEqual({ terminated: true });
    await expect.poll(() => processAlive(pid)).toBe(false);
  });

  it('closes sessions when stopped during native process creation', async () => {
    const { host } = await fixture();
    // Exercise cancellation on both sides of native startup. A suspended child
    // outside the Job would keep the session pipes open after launcher death.
    for (const delay of [0, 1, 2, 5, 10, 20, 0, 1, 2, 5, 10, 20]) {
      const result = await host.runTool('exec_command', {
        cmd: `${nodeCommand()} -e "setInterval(() => {}, 1000)"`, persist: true, yield_time_ms: 1,
      }, context);
      const id = (result.data as { process_id: string }).process_id;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      expect(await host.terminateBackgroundShellProcess(context.threadId, id)).toEqual({ terminated: true });
      expect(await host.listAllBackgroundShellProcesses()).toEqual([]);
    }
  });

  it('starts an interactive Electron window on the user desktop and keeps it managed across turns', async () => {
    const { host, projectDir } = await fixture();
    const electron = path.resolve('node_modules/electron/dist/electron.exe');
    const marker = path.join(projectDir, 'window.json');
    await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({
      private: true, packageManager: 'pnpm@7.33.7', scripts: { dev: `"${electron}" electron.cjs` },
    }));
    await writeFile(path.join(projectDir, 'electron.cjs'), [
      "const { app, BrowserWindow } = require('electron');",
      "const fs = require('node:fs');",
      "const profile = require('node:path').join(__dirname, 'electron-profile');",
      "fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);",
      'app.whenReady().then(async () => {',
      "  const window = new BrowserWindow({ width: 240, height: 120, title: 'Setsuna launcher verification' });",
      "  await window.loadURL('about:blank');",
      `  fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, hwnd: window.getNativeWindowHandle().readBigUInt64LE().toString() }));`,
      '});',
    ].join('\n'));
    const result = await host.runTool('exec_command', {
      cmd: 'pnpm dev', persist: true, yield_time_ms: 1,
    }, context);
    const id = (result.data as { process_id: string }).process_id;
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true);
    const window = JSON.parse(await readFile(marker, 'utf8')) as { pid: number; hwnd: string };
    const probe = fileURLToPath(new URL('./fixtures/window-desktop.ps1', import.meta.url));
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', probe, '-WindowHandle', window.hwnd], { windowsHide: true });
    const observed = JSON.parse(stdout) as { desktop: string; callerDesktop: string; inputDesktop: string; visible: boolean; responsive: boolean; pid: number };
    expect(observed).toMatchObject({ desktop: observed.callerDesktop, inputDesktop: observed.desktop, visible: true, responsive: true, pid: window.pid });
    await host.cleanupTurn(context, { status: 'completed' });
    expect(processAlive(window.pid)).toBe(true);
    expect((await host.runTool('read_shell_process', { process_id: id }, { ...context, turnId: 'managed_2' })).data).toMatchObject({ running: true });
    await host.terminateBackgroundShellProcess(context.threadId, id);
    await expect.poll(() => processAlive(window.pid), { timeout: 5_000 }).toBe(false);
  });
});

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
