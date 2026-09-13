import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract, list } from 'tar';

export type RepositoryFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export const OPENAI_PLUGIN_REPOSITORY = 'https://github.com/openai/plugins';
export const OPENAI_PLUGIN_MARKETPLACE_PREFIX = 'openai-plugins:';
export const OPENAI_PLUGIN_INDEX = '.agents/plugins/marketplace.json';

/** Download to a private staging directory; never extract a network stream directly. */
export async function downloadRepositoryArchive(
  fetch: RepositoryFetch,
  revision: string,
  archivePath: string,
  destination: string,
): Promise<void> {
  const response = await fetch(`https://codeload.github.com/openai/plugins/tar.gz/${revision}`, {
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  });
  if (!response.ok || !response.body) throw new Error(`Plugin repository download failed (HTTP ${response.status}).`);
  // Both compressed and expanded limits apply before any archive entry touches disk.
  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
    byteLimit(64 * 1024 * 1024),
    createGunzip(),
    byteLimit(192 * 1024 * 1024),
    createWriteStream(archivePath, { flags: 'wx' }),
  );
  await extractRepositoryArchive(archivePath, destination);
}

export async function extractRepositoryArchive(archivePath: string, destination: string): Promise<void> {
  let entries = 0;
  let invalid: string | undefined;
  let archiveRoot: string | undefined;
  const seen = new Set<string>();
  await list({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      entries += 1;
      const relative = entry.path.replace(/\/$/u, '');
      const segments = relative.split('/');
      archiveRoot ??= segments[0];
      if (entries > 20_000 || segments.length > 40 || segments[0] !== archiveRoot
        || segments.some(unsafeArchiveSegment)) {
        invalid ??= 'Plugin repository archive contains unsafe paths or too many entries.';
      }
      if (entry.type !== 'File' && entry.type !== 'Directory') {
        invalid ??= 'Plugin repository archives cannot contain links or special files.';
      }
      // Case-folding also catches aliases on Windows and typical macOS filesystems.
      const key = relative.toLowerCase();
      if (seen.has(key)) invalid ??= 'Plugin repository archive contains duplicate paths.';
      seen.add(key);
    },
  });
  if (invalid) throw new Error(invalid);
  if (!archiveRoot || !seen.has(`${archiveRoot}/${OPENAI_PLUGIN_INDEX}`.toLowerCase())) {
    throw new Error(`Plugin repository is missing ${OPENAI_PLUGIN_INDEX}.`);
  }
  await mkdir(destination, { recursive: true });
  await extract({
    file: archivePath,
    cwd: destination,
    strip: 1,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    maxDepth: 40,
    filter(entryPath) {
      const relative = entryPath.split('/').slice(1).join('/');
      return relative === OPENAI_PLUGIN_INDEX || relative.startsWith('plugins/');
    },
    onReadEntry(entry) {
      entry.mode = (entry.mode ?? 0o644) & 0o777;
    },
  });
}

function unsafeArchiveSegment(segment: string): boolean {
  return !segment || segment === '.' || segment === '..'
    || /[<>:"\\|?*]/u.test(segment) || [...segment].some((character) => character.charCodeAt(0) < 32)
    || /[. ]$/u.test(segment)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment);
}

function byteLimit(maxBytes: number): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new Error('Plugin repository archive exceeds its size limit.') : null, chunk);
    },
  });
}
