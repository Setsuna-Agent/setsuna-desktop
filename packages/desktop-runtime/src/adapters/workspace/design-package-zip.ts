import { open, rm } from 'node:fs/promises';
import type { Zip } from 'fflate';

type ArchiveBytes = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
type AppendZipEntry = (path: string, bytes: ArchiveBytes, compress?: boolean) => Promise<void>;
const compressionChunkBytes = 64 * 1024;

export async function writeDesignZip(target: string, signal: AbortSignal, write: (append: AppendZipEntry) => Promise<void>) {
  const { Zip, ZipDeflate, ZipPassThrough } = await import('fflate');
  signal.throwIfAborted();
  const handle = await open(target, 'wx', 0o600);
  const pending: Uint8Array[] = [];
  let failure: Error | null = null;
  let completed = false;
  const zip: Zip = new Zip((error, bytes) => {
    if (error) failure = error;
    else pending.push(bytes);
  });
  async function flush() {
    if (failure) throw failure;
    for (const chunk of pending.splice(0)) {
      signal.throwIfAborted();
      await handle.writeFile(chunk);
    }
  }

  try {
    await write(async (path, bytes, compress = true) => {
      const entry = compress ? new ZipDeflate(path, { level: 3 }) : new ZipPassThrough(path);
      zip.add(entry);
      // Feed one entry at a time and drain its output before reading another chunk.
      for await (const chunk of bytes) {
        for (let offset = 0; offset < chunk.length; offset += compressionChunkBytes) {
          signal.throwIfAborted();
          entry.push(chunk.subarray(offset, offset + compressionChunkBytes));
          await flush();
        }
      }
      entry.push(new Uint8Array(), true);
      await flush();
    });
    zip.end();
    await flush();
    signal.throwIfAborted();
    completed = true;
  } finally {
    zip.terminate();
    try {
      await handle.close();
    } finally {
      if (!completed) await rm(target, { force: true }).catch(() => undefined);
    }
  }
}
