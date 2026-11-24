import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { readWorkspaceFilePrefix } from './workspace-file-preview-reader.js';

type FileIdentity = { revision: string; documentId: string | undefined };
const catalogCacheSize = 2048;
const headerBytes = 2048;

export function createDesignCatalogFileReader() {
  const files = new Map<string, FileIdentity>();
  return (signal: AbortSignal) => {
    // Admit new entries after the scan so misses cannot evict the hits still ahead of us.
    const updates = new Map<string, FileIdentity>();
    return {
      async read(file: string) {
        const stats = await lstat(file, { bigint: true });
        if (!stats.isFile()) return;
        const revision = catalogRevision(stats);
        const previous = files.get(file);
        const documentId = previous?.revision === revision ? previous.documentId : await readDocumentId(file, stats, revision, signal);
        if (previous?.revision !== revision && updates.size < catalogCacheSize) updates.set(file, { revision, documentId });
        return { documentId, modifiedAt: stats.mtime.toISOString(), revision };
      },
      finish() {
        for (const [file, entry] of updates) files.set(file, entry);
        for (const file of files.keys()) {
          if (files.size <= catalogCacheSize) break;
          files.delete(file);
        }
      },
    };
  };
}

function catalogRevision(stats: BigIntStats) {
  // Detect both in-place edits and atomic replacements.
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':');
}

async function readDocumentId(file: string, stats: BigIntStats, revision: string, signal: AbortSignal) {
  if (!stats.size || stats.size > WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) return;
  if (path.relative(file, await realpath(file))) throw new Error('Design file moved during the catalog scan.');
  signal.throwIfAborted();
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || catalogRevision(opened) !== revision) throw new Error('Design file changed during the catalog scan.');
    const size = Number(opened.size);
    const prefix = await readWorkspaceFilePrefix(handle, Math.min(size, headerBytes));
    const id = documentIdInPrefix(prefix.toString('utf8'));
    if (id !== undefined || prefix.length === size) return id ?? undefined;
    // Files written by other tools can put the ID after their layer data.
    signal.throwIfAborted();
    const content = await readWorkspaceFilePrefix(handle, size, prefix);
    return documentIdInPrefix(content.toString('utf8')) ?? undefined;
  } finally {
    await handle.close();
  }
}

const escapedDocumentIdKeyLength = 'documentId'.length * 6 + 2;

function isDocumentIdKey(token: string) {
  if (token === '"documentId"') return true;
  if (token.length > escapedDocumentIdKeyLength || !token.includes('\\')) return false;
  try { return JSON.parse(token) === 'documentId'; } catch { return false; }
}

/** Inspect just the root ID. Undefined means the prefix may end before it, and null means the root has ended. */
function documentIdInPrefix(source: string): string | null | undefined {
  const start = source.search(/[^\t\n\r ]/u);
  if (start < 0) return;
  if (source[start] !== '{') return null;
  let depth = 1;
  let nextIsKey = true;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      const opening = index;
      while (++index < source.length && source[index] !== '"') {
        if (source[index] === '\\') index += 1;
      }
      if (index >= source.length) return;
      if (depth !== 1 || !nextIsKey) continue;
      nextIsKey = false;
      if (index - opening >= escapedDocumentIdKeyLength || !isDocumentIdKey(source.slice(opening, index + 1))) continue;
      const value = /\s*:\s*("(?:[a-zA-Z0-9_-]|\\u[a-fA-F0-9]{4}){1,128}")\s*(?=[,}])/uy;
      value.lastIndex = index + 1;
      const id = value.exec(source)?.[1];
      return id === undefined ? undefined : JSON.parse(id) as string;
    }
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      if (--depth === 0) return null;
    } else if (character === ',' && depth === 1) nextIsKey = true;
  }
}
