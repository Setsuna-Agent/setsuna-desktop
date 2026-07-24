import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { dataRootBootstrapLayout } from './layout.js';

const INCOMPLETE_LOCK_GRACE_MS = 30_000;

type BootstrapInstanceLockOwner = {
  version: 1;
  lockId: string;
  pid: number;
  createdAt: string;
};

export type BootstrapInstanceLock = {
  release(): void;
};

/**
 * Electron's singleton domain follows `userData`, which intentionally changes during
 * maintenance. This bootstrap directory lock stays stable across normal, migration and
 * recovery profiles, so only one process can inspect or mutate migration state at a time.
 */
export function acquireBootstrapInstanceLock(
  appDataRoot: string,
  options: {
    pid?: number;
    isProcessAlive?: (pid: number) => boolean;
    now?: () => Date;
  } = {},
): BootstrapInstanceLock | null {
  const lockRoot = dataRootBootstrapLayout(appDataRoot).instanceLockRoot;
  const bootstrapRoot = path.dirname(lockRoot);
  const ownerPath = path.join(lockRoot, 'owner.json');
  const pid = options.pid ?? process.pid;
  const now = options.now ?? (() => new Date());
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  mkdirSync(bootstrapRoot, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockRoot);
      const owner: BootstrapInstanceLockOwner = {
        version: 1,
        lockId: randomUUID(),
        pid,
        createdAt: now().toISOString(),
      };
      writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const current = readOwner(ownerPath);
          if (current?.lockId !== owner.lockId) return;
          rmSync(lockRoot, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        rmEmptyLockAfterFailedCreation(lockRoot);
        throw error;
      }
    }

    const owner = readOwner(ownerPath);
    if (owner && isProcessAlive(owner.pid)) return null;
    if (!owner && lockAgeMs(lockRoot, now()) < INCOMPLETE_LOCK_GRACE_MS) return null;
    quarantineStaleLock(lockRoot);
  }
  return null;
}

function quarantineStaleLock(lockRoot: string): void {
  if (!existsSync(lockRoot)) return;
  const quarantine = `${lockRoot}.stale-${randomUUID()}`;
  try {
    renameSync(lockRoot, quarantine);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return;
    throw error;
  }
  rmSync(quarantine, { recursive: true, force: true });
}

function rmEmptyLockAfterFailedCreation(lockRoot: string): void {
  try {
    if (existsSync(lockRoot) && !existsSync(path.join(lockRoot, 'owner.json'))) {
      rmSync(lockRoot, { recursive: true, force: true });
    }
  } catch {
    // The next startup's stale-lock recovery owns cleanup.
  }
}

function readOwner(ownerPath: string): BootstrapInstanceLockOwner | null {
  try {
    const value = JSON.parse(readFileSync(ownerPath, 'utf8')) as Partial<BootstrapInstanceLockOwner>;
    if (
      value.version !== 1
      || typeof value.lockId !== 'string'
      || !value.lockId
      || typeof value.pid !== 'number'
      || !Number.isSafeInteger(value.pid)
      || value.pid <= 0
      || typeof value.createdAt !== 'string'
    ) {
      return null;
    }
    return value as BootstrapInstanceLockOwner;
  } catch {
    return null;
  }
}

function lockAgeMs(lockRoot: string, now: Date): number {
  try {
    return Math.max(0, now.getTime() - statSync(lockRoot).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
