import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { watchWorkspaceEntries } from '../../../src/workspace/entry-watcher.js';

vi.mock('node:fs', () => ({ watch: vi.fn() }));
const watchDirectory = vi.mocked(watch as (
  root: string, options: { persistent: boolean; recursive: boolean },
  listener: (event: string, filename: string) => void,
) => FSWatcher);

it('uses one Windows root handle and filters events to listed directories and their ancestors', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'setsuna-windows-watch-')));
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
  vi.mocked(watch).mockReturnValue(watcher as unknown as FSWatcher);
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const changed = vi.fn();
  let dispose: (() => void) | undefined;
  try {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      dispose = await watchWorkspaceEntries(root, ['src', 'src/nested', 'future/nested'], changed);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    expect(watch).toHaveBeenCalledExactlyOnceWith(root, { persistent: false, recursive: true }, expect.any(Function));
    const notify = watchDirectory.mock.calls[0]![2];
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    try {
      notify('change', path.join('node_modules', 'dependency', 'index.js'));
      notify('change', path.join('src', 'unlisted', 'file.ts'));
      expect(schedule).not.toHaveBeenCalled();

      notify('change', path.join('src', 'nested', 'file.ts'));
      await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
      changed.mockClear();
      // Missing ancestors must be observable so their eventual entries can refresh.
      notify('rename', 'future');
      await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
      expect(watch).toHaveBeenCalledOnce();
    } finally {
      schedule.mockRestore();
    }
    dispose();
    expect(watcher.close).toHaveBeenCalledOnce();
    dispose = undefined;
  } finally {
    dispose?.();
    Object.defineProperty(process, 'platform', platform);
    await rm(root, { recursive: true, force: true });
  }
});
