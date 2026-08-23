import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrunedRecursiveWatcher } from '../../src/main/pruned-recursive-watcher.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0)
    .map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('pruned recursive watcher', () => {
  it('watches visible directories while pruning ignored trees before registration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-pruned-watch-'));
    temporaryDirectories.push(root);
    await Promise.all([
      mkdir(path.join(root, '.git', 'objects', 'aa'), { recursive: true }),
      mkdir(path.join(root, 'node_modules', 'dependency', 'src'), { recursive: true }),
      mkdir(path.join(root, 'src', 'nested'), { recursive: true }),
    ]);
    const callbacks = new Map<string, (eventType: string, filename: string | Buffer | null) => void>();
    const closeByDirectory = new Map<string, ReturnType<typeof vi.fn>>();
    const ignoreDirectories = vi.fn(async (relativePaths: string[]) => new Set(relativePaths
      .filter((relativePath) => relativePath === 'node_modules' || relativePath.startsWith('node_modules/'))));

    const watcher = await createPrunedRecursiveWatcher(root, () => undefined, {
      ignoreDirectories,
      shouldDescend: (relativePath) => relativePath !== '.git' && !relativePath.startsWith('.git/'),
      watchDirectory: (directoryPath, listener) => {
        const close = vi.fn();
        const eventEmitter = new EventEmitter();
        callbacks.set(directoryPath, listener);
        closeByDirectory.set(directoryPath, close);
        return Object.assign(eventEmitter, { close });
      },
    });

    expect([...callbacks.keys()].map((directoryPath) => relative(root, directoryPath)).sort()).toEqual([
      '.',
      'src',
      'src/nested',
    ]);
    expect(ignoreDirectories.mock.calls.flatMap(([relativePaths]) => relativePaths))
      .not.toContain('node_modules/dependency');

    await mkdir(path.join(root, 'generated', 'child'), { recursive: true });
    callbacks.get(root)?.('rename', 'generated');

    await waitForCondition(() => callbacks.has(path.join(root, 'generated', 'child')));
    watcher.close();
    expect([...closeByDirectory.values()].every((close) => close.mock.calls.length === 1)).toBe(true);
  });
});

function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for watcher reconciliation.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
