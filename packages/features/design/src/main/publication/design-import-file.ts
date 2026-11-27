import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { designPackageImportStagingPrefix, designPackageStagingFile, maxDesignPackageArchiveBytes,
  parseDesignPackageDestination, type ImportDesignPackageInput } from '../../contracts/design-package.js';
import type { DesignDocumentRef } from '../../contracts/operations.js';

export type DesignPackageImportHost = Readonly<{
  runtimeDirectory: string;
  importDesignPackage(input: ImportDesignPackageInput, signal: AbortSignal): Promise<DesignDocumentRef>;
}>;

export async function importDesignPackageFromDisk(source: unknown, input: unknown, host: DesignPackageImportHost, signal: AbortSignal) {
  const destination = parseDesignPackageDestination(input);
  if (typeof source !== 'string' || !path.isAbsolute(source) || path.extname(source).toLowerCase() !== '.zip') {
    throw new Error('Select a ZIP design package from disk.');
  }
  signal.throwIfAborted();
  const ticket = randomUUID();
  const staging = path.join(host.runtimeDirectory, designPackageImportStagingPrefix + ticket);
  await mkdir(staging, { mode: 0o700 });
  try {
    const archive = path.join(staging, designPackageStagingFile);
    await copyPackage(source, archive, signal);
    return await host.importDesignPackage({ destination, ticket }, signal);
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

async function copyPackage(source: string, archive: string, signal: AbortSignal) {
  const file = await open(source, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await file.stat();
    if (!stats.isFile() || !stats.size || stats.size > maxDesignPackageArchiveBytes) {
      throw new Error('The design package is invalid or too large.');
    }
    // The runtime reads a private, bounded copy identified only by the operation ticket.
    await pipeline(file.createReadStream({ start: 0, end: stats.size - 1, autoClose: false }),
      createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
    const after = await file.stat();
    if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs || after.ctimeMs !== stats.ctimeMs) {
      throw new Error('The design package changed while being read.');
    }
  } finally {
    await file.close();
  }
}
