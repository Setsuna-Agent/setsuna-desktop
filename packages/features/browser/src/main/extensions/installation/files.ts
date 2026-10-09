import { cp, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Validate both sides of the copy: the source may change while it is being read. */
export async function copyExtensionFiles(source: string, destination: string, signal: AbortSignal): Promise<void> {
  let files = 0;
  let bytes = 0;
  const inspectEntry = async (file: string) => {
    signal.throwIfAborted();
    const info = await lstat(file);
    if ((!info.isDirectory() && !info.isFile()) || ++files > 20_000 || (bytes += info.size) > 256 * 1024 * 1024) {
      throw new Error('Invalid extension files.');
    }
    return info;
  };
  await cp(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true,
    filter: async (file) => { await inspectEntry(file); return true; } });
  files = 0; bytes = 0;
  const inspect = async (file: string): Promise<void> => {
    if ((await inspectEntry(file)).isDirectory()) {
      for (const entry of await readdir(file)) await inspect(path.join(file, entry));
    }
  };
  await inspect(destination);
}
