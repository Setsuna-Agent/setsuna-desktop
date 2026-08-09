import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const trackedDirectories = new Set<string>();

afterAll(async () => {
  await removeTrackedTestTempDirectories();
});

export async function createTestTempDirectory(prefix: string): Promise<string> {
  return trackTestTempDirectory(await mkdtemp(path.join(tmpdir(), prefix)));
}

export function createTestTempDirectorySync(prefix: string): string {
  return trackTestTempDirectory(mkdtempSync(path.join(tmpdir(), prefix)));
}

export async function removeTestTempDirectory(directory: string): Promise<void> {
  if (!trackedDirectories.delete(directory)) return;
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

function trackTestTempDirectory(directory: string): string {
  trackedDirectories.add(directory);
  return directory;
}

async function removeTrackedTestTempDirectories(): Promise<void> {
  const outcomes = await Promise.allSettled(
    [...trackedDirectories].map((directory) => removeTestTempDirectory(directory)),
  );
  const failures = outcomes
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);
  if (failures.length) {
    throw new AggregateError(failures, 'Failed to remove test temporary directories.');
  }
}
