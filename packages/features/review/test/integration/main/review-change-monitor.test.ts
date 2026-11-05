import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopReviewChangeMonitor } from '../../../src/main/change-monitor.js';

const execFileAsync = promisify(execFile);
const repositories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { force: true, recursive: true })));
});

describe('DesktopReviewChangeMonitor', () => {
  it('notifies for Git-visible changes but ignores excluded and internal transaction files', async () => {
    const repository = await createGitRepository();
    const watched: Array<{
      closeCount: number;
      listener: (eventType: string, filename: string | Buffer | null) => void;
    }> = [];
    const resolveVisiblePath = vi.fn(async (_gitRoot: string, paths: string[]) => paths.includes('tracked.txt'));
    const monitor = new DesktopReviewChangeMonitor(10, (_directoryPath, listener) => {
      const watcher = new EventEmitter() as EventEmitter & { close: () => void };
      const record = { closeCount: 0, listener };
      watcher.close = () => { record.closeCount += 1; };
      watched.push(record);
      return watcher as never;
    }, resolveVisiblePath);
    let notificationCount = 0;
    const unsubscribe = await monitor.subscribe(repository, () => { notificationCount += 1; });
    expect(watched).toHaveLength(2);
    vi.useFakeTimers();
    try {
      watched[0]!.listener('change', 'ignored.log');
      await vi.advanceTimersByTimeAsync(10);
      expect(resolveVisiblePath).toHaveBeenLastCalledWith(expect.any(String), ['ignored.log']);
      expect(notificationCount).toBe(0);
      resolveVisiblePath.mockClear();

      watched[0]!.listener('rename', 'src/.setsuna-stage-42-123e4567-e89b-42d3-a456-426614174000');
      watched[0]!.listener('rename', 'src/.setsuna-backup-42-123e4567-e89b-42d3-a456-426614174000');
      await vi.advanceTimersByTimeAsync(40);
      expect(resolveVisiblePath).not.toHaveBeenCalled();
      expect(notificationCount).toBe(0);

      watched[0]!.listener('change', 'tracked.txt');
      await vi.advanceTimersByTimeAsync(10);
      expect(notificationCount).toBe(1);

      watched[1]!.listener('rename', 'index.lock');
      watched[1]!.listener('rename', 'refs/heads/main.lock');
      await vi.advanceTimersByTimeAsync(40);
      expect(notificationCount).toBe(1);

      watched[1]!.listener('change', 'HEAD');
      await vi.advanceTimersByTimeAsync(10);
      expect(notificationCount).toBe(2);
    } finally {
      unsubscribe();
      monitor.close();
    }
    expect(watched.every((entry) => entry.closeCount === 1)).toBe(true);
  });

  it('waits for a quiet period before notifying a sustained metadata burst', async () => {
    const repository = await createGitRepository();
    const watched: Array<{
      listener: (eventType: string, filename: string | Buffer | null) => void;
    }> = [];
    const monitor = new DesktopReviewChangeMonitor(10, (_directoryPath, listener) => {
      const watcher = new EventEmitter() as EventEmitter & { close: () => void };
      watcher.close = () => undefined;
      watched.push({ listener });
      return watcher as never;
    });
    let notificationCount = 0;
    const unsubscribe = await monitor.subscribe(repository, () => { notificationCount += 1; });
    vi.useFakeTimers();

    try {
      watched[1]!.listener('change', 'HEAD');
      await vi.advanceTimersByTimeAsync(9);
      watched[1]!.listener('change', 'HEAD');
      await vi.advanceTimersByTimeAsync(1);
      expect(notificationCount).toBe(0);

      await vi.advanceTimersByTimeAsync(9);
      expect(notificationCount).toBe(1);
    } finally {
      unsubscribe();
      monitor.close();
      vi.useRealTimers();
    }
  });

  it('bounds the debounce window when ignored-file churn follows a visible change', async () => {
    const repository = await createGitRepository();
    const watched: Array<{
      listener: (eventType: string, filename: string | Buffer | null) => void;
    }> = [];
    const resolveVisiblePath = vi.fn(async (_gitRoot: string, paths: string[]) => paths.includes('tracked.txt'));
    const monitor = new DesktopReviewChangeMonitor(10, (_directoryPath, listener) => {
      const watcher = new EventEmitter() as EventEmitter & { close: () => void };
      watcher.close = () => undefined;
      watched.push({ listener });
      return watcher as never;
    }, resolveVisiblePath);
    let notificationCount = 0;
    const unsubscribe = await monitor.subscribe(repository, () => { notificationCount += 1; });
    vi.useFakeTimers();

    try {
      watched[0]!.listener('change', 'tracked.txt');
      for (let index = 0; index < 4; index += 1) {
        await vi.advanceTimersByTimeAsync(9);
        watched[0]!.listener('change', 'ignored.log');
      }
      expect(notificationCount).toBe(0);

      await vi.advanceTimersByTimeAsync(4);
      expect(notificationCount).toBe(1);
      expect(resolveVisiblePath).toHaveBeenCalledWith(expect.any(String), ['tracked.txt', 'ignored.log']);
    } finally {
      unsubscribe();
      monitor.close();
      vi.useRealTimers();
    }
  });
});

async function createGitRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), 'setsuna-review-monitor-'));
  repositories.push(repository);
  await git(repository, ['init']);
  await git(repository, ['config', 'user.email', 'setsuna@example.com']);
  await git(repository, ['config', 'user.name', 'Setsuna Tests']);
  await writeFile(path.join(repository, '.gitignore'), '*.log\n');
  await writeFile(path.join(repository, 'tracked.txt'), 'initial\n');
  await git(repository, ['add', '.gitignore', 'tracked.txt']);
  await git(repository, ['commit', '-m', 'initial']);
  return repository;
}

async function git(repository: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: repository });
}
