import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopReviewChangeMonitor } from '../../../src/review/change-monitor.js';

const execFileAsync = promisify(execFile);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { force: true, recursive: true })));
});

describe('DesktopReviewChangeMonitor', () => {
  it('observes a real tracked-file write through the native worktree watcher', async () => {
    const repository = await createGitRepository();
    const monitor = new DesktopReviewChangeMonitor(20);
    let notify!: () => void;
    const changed = new Promise<void>((resolve) => { notify = resolve; });
    const unsubscribe = await monitor.subscribe(repository, notify);

    await writeFile(path.join(repository, 'tracked.txt'), 'changed\n');
    await withTimeout(changed, 3_000);

    unsubscribe();
    monitor.close();
  });

  it('notifies for Git-visible changes but ignores excluded and internal transaction files', async () => {
    const repository = await createGitRepository();
    const watched: Array<{
      closeCount: number;
      listener: (eventType: string, filename: string | Buffer | null) => void;
    }> = [];
    const monitor = new DesktopReviewChangeMonitor(10, (_directoryPath, listener) => {
      const watcher = new EventEmitter() as EventEmitter & { close: () => void };
      const record = { closeCount: 0, listener };
      watcher.close = () => { record.closeCount += 1; };
      watched.push(record);
      return watcher as never;
    });
    let notificationCount = 0;
    const unsubscribe = await monitor.subscribe(repository, () => { notificationCount += 1; });
    expect(watched).toHaveLength(2);

    watched[0]!.listener('change', 'ignored.log');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(notificationCount).toBe(0);

    watched[0]!.listener('rename', 'src/.setsuna-stage-42-123e4567-e89b-42d3-a456-426614174000');
    watched[0]!.listener('rename', 'src/.setsuna-backup-42-123e4567-e89b-42d3-a456-426614174000');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(notificationCount).toBe(0);

    watched[0]!.listener('change', 'tracked.txt');
    await waitForCondition(() => notificationCount === 1);

    watched[1]!.listener('change', 'HEAD');
    await waitForCondition(() => notificationCount === 2);

    unsubscribe();
    expect(watched.every((entry) => entry.closeCount === 1)).toBe(true);
    monitor.close();
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

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for review monitor event.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for native review watcher event.')), timeoutMs);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
