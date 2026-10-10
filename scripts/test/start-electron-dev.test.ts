import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DESKTOP_DEV_RELAUNCH_EXIT_CODE } from '../../apps/desktop/main/src/dev-relaunch-protocol.js';
import { resolveElectronDevApp } from '../prepare-electron-dev-app.js';

vi.mock('electron', () => ({ default: '/original/Electron' }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock('../build-electron.js', () => ({ buildElectron: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../prepare-electron-dev-app.js', () => ({ resolveElectronDevApp: vi.fn() }));

const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn>; exitCode: null; signalCode: null }> = [];
const signals = new Map<string | symbol, (...args: unknown[]) => void>();

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const once = process.once;
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (event === 'SIGINT' || event === 'SIGTERM') {
      signals.set(event, listener);
      return process;
    }
    return once.call(process, event, listener);
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), exitCode: null, signalCode: null });
    children.push(child);
    return child as unknown as ReturnType<typeof spawn>;
  });
});

afterEach(() => {
  children.length = 0;
  signals.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('launches and relaunches without waiting for slow preparation, then uses the prepared app on the next launch', async () => {
  let ready!: (executable: string) => void;
  const prepare = vi.fn(() => new Promise<string>((resolve) => { ready = resolve; }));
  vi.mocked(resolveElectronDevApp).mockReturnValue({ executable: '/original/Electron', prepare });

  await import('../start-electron-dev.js');
  expect(spawn).toHaveBeenCalledExactlyOnceWith('/original/Electron', ['.'], expect.any(Object));
  expect(vi.mocked(spawn).mock.invocationCallOrder[0]).toBeLessThan(prepare.mock.invocationCallOrder[0]);
  children[0].emit('close', DESKTOP_DEV_RELAUNCH_EXIT_CODE, null);
  expect(spawn).toHaveBeenLastCalledWith('/original/Electron', ['.'], expect.any(Object));
  expect(children).toHaveLength(2);

  ready('/prepared/Electron');
  await vi.waitFor(() => expect(console.info).toHaveBeenCalledWith(expect.stringContaining('notification app ready')));
  expect(children).toHaveLength(2);
  children[1].emit('close', DESKTOP_DEV_RELAUNCH_EXIT_CODE, null);
  expect(spawn).toHaveBeenLastCalledWith('/prepared/Electron', ['.'], expect.any(Object));
  children[2].emit('close', 0, null);
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
});

it('keeps Electron running when background preparation fails', async () => {
  const failure = new Error('Signing timed out');
  const prepare = vi.fn().mockRejectedValue(failure);
  vi.mocked(resolveElectronDevApp).mockReturnValue({ executable: '/original/Electron', prepare });
  await import('../start-electron-dev.js');
  await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Electron continues running'), failure));
  expect(spawn).toHaveBeenCalledOnce();
  expect(children[0].kill).not.toHaveBeenCalled();
  expect(process.exit).not.toHaveBeenCalled();
  children[0].emit('close', 0, null);
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
});

it('aborts preparation on termination and ignores a late result before exiting', async () => {
  let ready!: (executable: string) => void;
  let signal!: AbortSignal;
  const prepare = vi.fn((value: AbortSignal) => {
    signal = value;
    return new Promise<string>((resolve) => { ready = resolve; });
  });
  vi.mocked(resolveElectronDevApp).mockReturnValue({ executable: '/original/Electron', prepare });
  await import('../start-electron-dev.js');
  signals.get('SIGTERM')!();
  expect(signal.aborted).toBe(true);
  expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
  children[0].emit('close', null, 'SIGTERM');
  expect(process.exit).not.toHaveBeenCalled();
  ready('/late/Electron');
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(143));
  expect(console.info).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledOnce();
});

it('uses a valid cached executable directly', async () => {
  vi.mocked(resolveElectronDevApp).mockReturnValue({ executable: '/cached/Electron' });
  await import('../start-electron-dev.js');
  expect(spawn).toHaveBeenCalledExactlyOnceWith('/cached/Electron', ['.'], expect.any(Object));
  children[0].emit('close', 0, null);
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
});
