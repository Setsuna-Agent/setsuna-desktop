import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { openPromise, type Entry, type ZipFile } from 'yauzl';
import { designPackageContentPrefix, designPackageManifestFile, maxDesignPackageContentBytes,
  maxDesignPackageFiles, maxDesignPackageManifestBytes } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { isNodeError } from '../../shared/node-errors.js';
import { designPackageTooLarge, reserveDesignPackagePath, type DesignPackagePaths } from './design-package-dependencies.js';

type DesignPackageArchive = Readonly<{
  entryCount: number;
  extract(name: string, target: string, limit: number): Promise<number>;
}>;

export async function withDesignPackageArchive<T>(source: string, signal: AbortSignal, use: (archive: DesignPackageArchive) => Promise<T>) {
  let zip: ZipFile | undefined;
  try {
    signal.throwIfAborted();
    zip = await openPromise(source, { autoClose: false, decodeStrings: false });
    const archive = zip;
    const entries = await indexArchive(archive, signal);
    return await use({ entryCount: entries.size, extract: (name, target, limit) => extract(archive, entries, name, target, limit, signal) });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FeatureOperationFailure || (isNodeError(error) && error.syscall)) throw error;
    throw invalidDesignPackage();
  } finally {
    if (zip) {
      const closed = once(zip, 'close');
      zip.close();
      await closed;
    }
  }
}

async function indexArchive(zip: ZipFile, signal: AbortSignal) {
  if (zip.entryCount > maxDesignPackageFiles + 1) throw designPackageTooLarge();
  const names: DesignPackagePaths = new Map();
  const entries = new Map<string, Entry>();
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let contentBytes = 0;
  let compressedBytes = 0;
  let extraBytes = 0;
  for await (const entry of zip.eachEntry()) {
    signal.throwIfAborted();
    const name = utf8.decode(entry.fileNameRaw);
    const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
    const dosDirectoryOrReparsePoint = entry.externalFileAttributes & 0x410;
    if (entries.has(name) || !entry.canDecodeFileData() || dosDirectoryOrReparsePoint
      || (unixType !== 0 && unixType !== 0o100000)) throw invalidDesignPackage();
    compressedBytes += entry.compressedSize;
    if (compressedBytes > zip.fileSize) throw invalidDesignPackage();
    extraBytes += entry.extraFieldLength + entry.fileCommentLength;
    if (extraBytes > 4 * 1024 ** 2) throw designPackageTooLarge();
    if (name === designPackageManifestFile) {
      if (entry.uncompressedSize > maxDesignPackageManifestBytes) throw designPackageTooLarge();
    } else {
      if (!name.startsWith(designPackageContentPrefix)) throw invalidDesignPackage();
      reserveDesignPackagePath(name.slice(designPackageContentPrefix.length), names);
      contentBytes += entry.uncompressedSize;
      if (contentBytes > maxDesignPackageContentBytes) throw designPackageTooLarge();
    }
    entries.set(name, entry);
  }
  return entries;
}

async function extract(zip: ZipFile, entries: ReadonlyMap<string, Entry>, name: string, target: string, limit: number, signal: AbortSignal) {
  const entry = entries.get(name);
  if (!entry) throw invalidDesignPackage(`The design package is missing "${name}".`);
  if (entry.uncompressedSize > limit) throw designPackageTooLarge();
  signal.throwIfAborted();
  const stream = await zip.openReadStreamPromise(entry);
  await pipeline(stream, async function* (chunks: AsyncIterable<Buffer>) {
    let checksum = 0;
    for await (const chunk of chunks) {
      checksum = crc32(chunk, checksum);
      yield chunk;
    }
    // The ZIP reader enforces the declared size. Verify the complete payload as well.
    if (checksum !== entry.crc32) throw invalidDesignPackage(`The design package entry "${name}" is damaged.`);
  }, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  return entry.uncompressedSize;
}

export function invalidDesignPackage(message = 'The ZIP is not a valid Setsuna design package.') {
  return new FeatureOperationFailure({ code: 'DESIGN_PACKAGE_INVALID', message, retryable: false });
}
