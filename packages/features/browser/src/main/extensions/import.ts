import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Extension } from 'electron';
import { readInstalledExtensions } from './installations.js';
import { validExtensionId } from './metadata.js';

/** Copy the installation only; Chromium storage databases are owned by the source browser. */
export async function copyImportedExtension(source: Extension, directory: string, signal: AbortSignal): Promise<string | null> {
  if (!validExtensionId(source.id) || source.manifest.manifest_version !== 3 || !/^\d+(?:\.\d+){0,3}$/.test(source.version)) {
    throw new Error('Unsupported extension installation.');
  }
  await mkdir(directory, { recursive: true });
  const staging = path.join(directory, `.import-${randomUUID()}`);
  const staged = path.join(staging, source.id, `${source.version}_0`);
  const target = path.join(directory, source.id);
  let created = false;
  let files = 0;
  let bytes = 0;
  const checkFile = async (file: string) => {
    signal.throwIfAborted();
    const info = await lstat(file);
    if ((!info.isDirectory() && !info.isFile()) || ++files > 20_000 || (bytes += info.size) > 256 * 1024 * 1024) {
      throw new Error('Invalid extension files.');
    }
  };
  try {
    await cp(source.path, staged, { recursive: true, dereference: false, verbatimSymlinks: true,
      filter: async (file) => { await checkFile(file); return true; } });
    // Validate the copied snapshot too, so a source changed during copy cannot leave executable links.
    files = 0; bytes = 0;
    const inspect = async (file: string): Promise<void> => {
      await checkFile(file);
      if ((await lstat(file)).isDirectory()) {
        for (const entry of await readdir(file)) await inspect(path.join(file, entry));
      }
    };
    await inspect(staged);
    const copied = (await readInstalledExtensions(staging)).find((extension) => extension.id === source.id);
    if (!copied || copied.version !== source.version) throw new Error('Extension changed during import.');
    signal.throwIfAborted();
    try { await mkdir(target); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null; throw error; }
    const location = path.join(target, `${source.version}_0`);
    await rename(staged, location);
    return location;
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true });
    throw error;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
