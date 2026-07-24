import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const WINDOWS_RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WINDOWS_RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200, 400, 800, 1_600];
const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set(['EPERM', 'EINVAL']);

export function isAtomicJsonTemporaryFileName(
  fileName: string,
  destinationFileName: string,
): boolean {
  const prefix = `.${path.basename(destinationFileName)}.`;
  return fileName.startsWith(prefix) && fileName.endsWith('.tmp');
}

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(directory);
}

export async function removeFileDurably(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
  await syncDirectory(path.dirname(filePath));
}

async function syncDirectory(directory: string): Promise<void> {
  const directoryHandle = await open(directory, 'r').catch(() => null);
  if (!directoryHandle) return;
  try {
    await directoryHandle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) throw error;
  } finally {
    await directoryHandle.close();
  }
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  if (process.platform !== 'win32' || !(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  // Windows can open directory handles but does not support fsync on them.
  return Boolean(code && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code));
}

async function renameWithRetry(sourcePath: string, destinationPath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!shouldRetryRename(error, attempt)) throw error;
      await delay(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function shouldRetryRename(error: unknown, attempt: number): boolean {
  if (process.platform !== 'win32' || attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) return false;
  const code = error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return Boolean(code && WINDOWS_RENAME_RETRY_CODES.has(code));
}
