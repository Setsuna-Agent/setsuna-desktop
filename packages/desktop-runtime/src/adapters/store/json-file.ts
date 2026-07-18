import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const WINDOWS_RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WINDOWS_RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200, 400, 800, 1_600];

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown, options: { mode?: number } = {}): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function writeTextFile(filePath: string, content: string, options: { mode?: number } = {}): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { encoding: 'utf8', mode: options.mode });
  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function parseJsonLine<T>(line: string): T | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/**
 * Windows virus scanners and short-lived child processes can temporarily retain a
 * handle after a file has been read. Retry atomic moves without weakening rollback.
 */
export async function renameWithRetry(
  sourcePath: string,
  destinationPath: string,
  options: { platform?: NodeJS.Platform } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!shouldRetryRename(error, attempt, platform)) throw error;
      await delay(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function shouldRetryRename(error: unknown, attempt: number, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32' || attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) return false;
  const code = errorCode(error);
  return Boolean(code && WINDOWS_RENAME_RETRY_CODES.has(code));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
