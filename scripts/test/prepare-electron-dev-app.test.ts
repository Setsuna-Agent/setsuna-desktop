import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveElectronDevApp } from '../prepare-electron-dev-app.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const roots: string[] = [];
const commands = vi.mocked(execFile);

afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'setsuna-dev-app-'));
  roots.push(root);
  const source = join(root, 'dependency/Electron.app');
  const executable = join(source, 'Contents/MacOS/Electron');
  const plist = join(source, 'Contents/Info.plist');
  mkdirSync(join(source, 'Contents/MacOS'), { recursive: true });
  mkdirSync(join(source, 'Contents/Resources'), { recursive: true });
  mkdirSync(join(root, 'assets/build'), { recursive: true });
  writeFileSync(executable, 'Electron fixture');
  writeFileSync(plist, 'original Electron bundle info');
  writeFileSync(join(root, 'assets/build/icon.icns'), 'Setsuna icon');
  commands.mockImplementation((command, args, _options, callback) => {
    const child = new EventEmitter() as ChildProcess;
    queueMicrotask(() => {
      const values = args as string[];
      if (command === '/usr/bin/ditto') cpSync(values[0], values[1], { recursive: true });
      callback!(null, '', '');
      child.emit('close', 0, null);
    });
    return child;
  });
  return { root, executable, plist, cache: join(root, '.cache/electron-dev') };
}

describe('macOS development app signing', () => {
  it('selects the original immediately on a cache miss, then reuses the separately signed app without OS work', async () => {
    const { root, executable, plist } = fixture();
    const cold = resolveElectronDevApp(root, executable, 'darwin');
    expect(cold.executable).toBe(executable);
    expect(commands).not.toHaveBeenCalled();
    const prepared = await cold.prepare!(new AbortController().signal);
    expect(prepared).not.toBe(executable);
    expect(readFileSync(prepared, 'utf8')).toBe('Electron fixture');
    expect(readFileSync(plist, 'utf8')).toBe('original Electron bundle info');
    expect(commands).toHaveBeenCalledWith('/usr/bin/codesign',
      ['--verify', '--deep', '--strict', expect.any(String)], expect.any(Object), expect.any(Function));
    expect(commands).toHaveBeenCalledWith(expect.stringContaining('lsregister'),
      ['-f', join(root, '.cache/electron-dev/Setsuna Desktop Dev.app')], expect.any(Object), expect.any(Function));

    commands.mockClear();
    expect(resolveElectronDevApp(root, executable, 'darwin')).toEqual({ executable: prepared });
    expect(commands).not.toHaveBeenCalled();

    writeFileSync(executable, 'updated Electron fixture');
    const stale = resolveElectronDevApp(root, executable, 'darwin');
    expect(stale.executable).toBe(executable);
    await stale.prepare!(new AbortController().signal);
    expect(readFileSync(prepared, 'utf8')).toBe('updated Electron fixture');
    expect(commands).toHaveBeenCalled();
  });

  it('keeps the previous bundle after signing fails and cleans incomplete staging before retry', async () => {
    const { root, executable, cache } = fixture();
    const prepared = await resolveElectronDevApp(root, executable, 'darwin').prepare!(new AbortController().signal);
    writeFileSync(executable, 'new Electron fixture');
    const successfulRun = commands.getMockImplementation()!;
    commands.mockImplementation((command, args, options, callback) => {
      if (command === '/usr/bin/codesign') {
        const child = new EventEmitter() as ChildProcess;
        queueMicrotask(() => { callback!(new Error('Signing failed'), '', ''); child.emit('close', 1, null); });
        return child;
      }
      return successfulRun(command, args, options, callback);
    });
    await expect(resolveElectronDevApp(root, executable, 'darwin').prepare!(new AbortController().signal)).rejects.toThrow('Signing failed');
    expect(readFileSync(prepared, 'utf8')).toBe('Electron fixture');
    expect(readdirSync(cache).some((entry) => entry.startsWith('.prepare-'))).toBe(false);

    commands.mockImplementation(successfulRun);
    expect(await resolveElectronDevApp(root, executable, 'darwin').prepare!(new AbortController().signal)).toBe(prepared);
    expect(readFileSync(prepared, 'utf8')).toBe('new Electron fixture');
    rmSync(prepared);
    await resolveElectronDevApp(root, executable, 'darwin').prepare!(new AbortController().signal);
    expect(existsSync(prepared)).toBe(true);
  });

  it('cancels a slow command, waits for its exit, and never registers a late result', async () => {
    const { root, executable, cache } = fixture();
    const abort = new AbortController();
    let commandStarted!: () => void;
    const started = new Promise<void>((resolve) => { commandStarted = resolve; });
    let finishCommand!: () => void;
    commands.mockImplementation((_command, _args, options, callback) => {
      const child = new EventEmitter() as ChildProcess;
      expect(options).toMatchObject({ signal: abort.signal, timeout: 30_000, killSignal: 'SIGKILL' });
      abort.signal.addEventListener('abort', () => callback!(abort.signal.reason as ExecFileException, '', ''), { once: true });
      finishCommand = () => child.emit('close', null, 'SIGKILL');
      commandStarted();
      return child;
    });
    const preparing = resolveElectronDevApp(root, executable, 'darwin').prepare!(abort.signal);
    const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    abort.abort();
    expect(readdirSync(cache).some((entry) => entry.startsWith('.prepare-'))).toBe(true);
    finishCommand();
    await rejected;
    expect(commands).toHaveBeenCalledOnce();
    expect(readdirSync(cache)).toEqual([]);
    expect(resolveElectronDevApp(root, executable, 'darwin').executable).toBe(executable);
  });

  it('keeps Windows on its existing executable without reading files or running macOS tools', () => {
    const executable = String.raw`C:\Setsuna\node_modules\electron\dist\electron.exe`;
    expect(resolveElectronDevApp('does-not-exist', executable, 'win32')).toEqual({ executable });
    expect(commands).not.toHaveBeenCalled();
  });
});
