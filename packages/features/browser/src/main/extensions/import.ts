import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Extension } from 'electron';
import { readInstalledExtensions } from './installations.js';
import { validExtensionId } from './metadata.js';
import { copyExtensionFiles } from './installation/files.js';

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
  try {
    await copyExtensionFiles(source.path, staged, signal);
    const copied = (await readInstalledExtensions(staging, 3)).find((extension) => extension.id === source.id);
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
