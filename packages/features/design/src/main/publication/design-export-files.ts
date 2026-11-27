import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { dialog, type BrowserWindow } from 'electron';
import { detectWorkspacePreviewImageMimeType, isValidWorkspaceEntryName, MAX_DESKTOP_IMAGE_BYTES } from '@setsuna-desktop/contracts';
import type { DesignExportInput, DesignPreparedExport } from '../../contracts/design-export.js';
import { designPackageStagingFile, designPackageStagingPrefix, parseDesignSavedVersion,
  type DesignPackageReceipt, type DesignSavedVersion, type PrepareDesignPackageInput } from '../../contracts/design-package.js';
import { designDocumentFileExtension } from '../../contracts/design-resource-id.js';

const maxTextBytes = 32 * 1024 ** 2;

export type DesignPackageMainHost = Readonly<{
  runtimeDirectory: string;
  prepareDesignPackage(input: PrepareDesignPackageInput, signal: AbortSignal): Promise<DesignPackageReceipt>;
}>;
export type PreparedDesignFile = DesignPreparedExport & Readonly<{ directory: string; path: string; extension: string }>;

export async function prepareDesignExport(value: unknown, host: DesignPackageMainHost, temporaryRoot: string, signal: AbortSignal): Promise<PreparedDesignFile> {
  const input = parseExport(value);
  signal.throwIfAborted();
  const directory = await mkdtemp(path.join(temporaryRoot, 'setsuna-design-export-'));
  try {
    const target = path.join(directory, input.name);
    const archive = input.kind === 'zip'
      ? await preparePackage(input.version, host, target, signal)
      : undefined;
    if (input.kind !== 'zip') await writeFile(target, input.bytes, { flag: 'wx', mode: 0o600, signal });
    signal.throwIfAborted();
    return { directory, path: target, name: input.name, extension: input.kind, archive };
  } catch (error) {
    await removeExportDirectory(directory);
    throw error;
  }
}

function parseExport(value: unknown) {
  const input = value as Partial<DesignExportInput> | null;
  if (input?.kind === 'zip') {
    const version = parseDesignSavedVersion(input.version);
    const filename = version.ref.path.split('/').at(-1)!;
    return { kind: input.kind, version, name: filename.slice(0, -designDocumentFileExtension.length) + 'zip' };
  }
  if (!input || (input.kind !== 'png' && input.kind !== 'html' && input.kind !== 'svg')
    || !isValidWorkspaceEntryName(input.name) || !input.name.toLowerCase().endsWith('.' + input.kind)
    || typeof input.content !== 'string') throw new Error('Invalid design export.');
  if (input.kind === 'png') {
    if (input.content.length > Math.ceil(MAX_DESKTOP_IMAGE_BYTES * 4 / 3) + 32) throw new Error('The PNG export is too large.');
    const base64 = /^data:image\/png;base64,([a-z0-9+/]+={0,2})$/iu.exec(input.content)?.[1];
    const bytes = base64 ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
    if (bytes.length > MAX_DESKTOP_IMAGE_BYTES || detectWorkspacePreviewImageMimeType(bytes) !== 'image/png') throw new Error('Invalid design PNG.');
    return { kind: input.kind, name: input.name, bytes };
  }
  if (Buffer.byteLength(input.content) > maxTextBytes) throw new Error('The design export is too large.');
  return { kind: input.kind, name: input.name, bytes: input.content };
}

async function preparePackage(version: DesignSavedVersion, host: DesignPackageMainHost, destination: string, signal: AbortSignal) {
  const ticket = randomUUID();
  const staged = path.join(host.runtimeDirectory, designPackageStagingPrefix + ticket);
  await mkdir(staged, { mode: 0o700 });
  try {
    const receipt = await host.prepareDesignPackage({ ...version, ticket }, signal);
    if (receipt.ticket !== ticket) throw new Error('Invalid design package receipt.');
    const archive = path.join(staged, designPackageStagingFile);
    signal.throwIfAborted();
    try {
      await rename(archive, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyExport(archive, destination, signal);
    }
    return receipt.archive;
  } finally {
    await removeExportDirectory(staged);
  }
}

export async function savePreparedDesignExport(window: BrowserWindow, file: PreparedDesignFile, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  const destination = await chooseDestination(window, file, signal);
  if (!destination) return null;
  if (!destination.toLowerCase().endsWith('.' + file.extension)) throw new Error('The export requires a .' + file.extension + ' filename.');
  const directory = await mkdtemp(path.join(path.dirname(destination), '.setsuna-design-'));
  try {
    const partial = path.join(directory, 'export.tmp');
    await copyExport(file.path, partial, signal);
    signal.throwIfAborted();
    await rename(partial, destination);
    return destination;
  } finally {
    await removeExportDirectory(directory);
  }
}

function copyExport(source: string, target: string, signal: AbortSignal) {
  return pipeline(createReadStream(source), createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
}

export async function removeExportDirectory(directory: string) {
  await rm(directory, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}

function chooseDestination(window: BrowserWindow, file: PreparedDesignFile, signal: AbortSignal) {
  return new Promise<string | null>((resolve, reject) => {
    // Shutdown can release an export even while the native picker is still open.
    const abort = () => resolve(null);
    signal.addEventListener('abort', abort, { once: true });
    void dialog.showSaveDialog(window, { defaultPath: file.name, filters: [{ name: file.extension.toUpperCase(), extensions: [file.extension] }] })
      .then((choice) => resolve(choice.canceled ? null : choice.filePath ?? null), reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
