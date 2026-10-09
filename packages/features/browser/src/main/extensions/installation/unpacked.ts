import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Extension } from 'electron';
import type { BrowserExtensionInstallFailure } from '../../../contracts/extensions.js';
import { extensionIdForKey, validExtensionVersion } from '../installations.js';
import { copyExtensionFiles } from './files.js';

export class BrowserExtensionInstallError extends Error {
  constructor(readonly reason: BrowserExtensionInstallFailure) { super(reason); }
}

/** Snapshot before consent so only the manifest the user approved can be loaded. */
export async function prepareUnpackedExtension(source: string, directory: string, signal: AbortSignal, workspaceRoot?: string) {
  signal.throwIfAborted();
  const canonicalSource = await realpath(source);
  if (workspaceRoot !== undefined) {
    // Keep the runtime's approved root fixed across the process/queue boundary;
    // resolving a replaced root must not authorize its new symlink target.
    const relative = path.relative(workspaceRoot, canonicalSource);
    if (!path.isAbsolute(workspaceRoot) || path.relative(workspaceRoot, await realpath(workspaceRoot)) !== ''
      || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new BrowserExtensionInstallError('invalid-extension');
    }
  }
  await mkdir(directory, { recursive: true });
  const relative = path.relative(canonicalSource, await realpath(directory));
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new BrowserExtensionInstallError('invalid-extension');
  }
  const staging = await mkdtemp(path.join(directory, '.install-'));
  const snapshot = path.join(staging, 'extension');
  try {
    await copyExtensionFiles(canonicalSource, snapshot, signal);
    const file = path.join(snapshot, 'manifest.json');
    const info = await lstat(file);
    if (!info.isFile() || info.size > 100 * 1024) throw new BrowserExtensionInstallError('invalid-extension');
    const manifest = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || typeof manifest.name !== 'string' || !manifest.name.trim() || !validExtensionVersion(manifest.version)) {
      throw new BrowserExtensionInstallError('invalid-extension');
    }
    if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
      throw new BrowserExtensionInstallError('unsupported-manifest');
    }
    // Chromium hashes key bytes for identity. A local key keeps keyless downloads
    // stable across the move to managed storage, retries and application restarts.
    manifest.key ??= createHash('sha256').update(process.platform === 'win32' ? canonicalSource.toLowerCase() : canonicalSource).digest('base64');
    const id = extensionIdForKey(manifest.key);
    if (!id) throw new BrowserExtensionInstallError('invalid-extension');
    await writeFile(file, JSON.stringify(manifest));
    signal.throwIfAborted();
    const extension: Extension = { id, name: manifest.name, version: manifest.version, manifest, path: snapshot, url: `chrome-extension://${id}/` };
    return { extension, dispose: () => rm(staging, { recursive: true, force: true }) };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

/** Reserve the ID atomically; never replace an existing store or local installation. */
export async function commitUnpackedExtension(extension: Extension, directory: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const root = path.join(directory, extension.id);
  try { await mkdir(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BrowserExtensionInstallError('already-installed');
    throw error;
  }
  const location = path.join(root, `${extension.version}_0`);
  try { signal.throwIfAborted(); await rename(extension.path, location); return location; }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
