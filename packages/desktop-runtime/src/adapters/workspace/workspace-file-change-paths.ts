import { randomUUID } from 'node:crypto';
import { open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

type ChangePath = { filePath: string; directory: string; suffix: string };

/** Resolve aliases even after deletion, without assuming an OS-wide casing rule. */
export async function groupFileChangePaths(paths: string[]): Promise<Map<string, string>> {
  const candidates = new Map<string, ChangePath[]>();
  for (const filePath of new Set(paths)) {
    const { directory, info } = await existingParent(filePath);
    const suffix = path.relative(directory, filePath);
    // Distinct directories (or hard links with different names) must stay distinct.
    const key = JSON.stringify([String(info.dev), String(info.ino), suffix.toLowerCase()]);
    const group = candidates.get(key) ?? [];
    group.push({ filePath, directory, suffix });
    candidates.set(key, group);
  }
  const grouped = new Map<string, string>();
  const insensitiveDirectories = new Map<string, boolean>();
  for (const group of candidates.values()) {
    const first = group[0]!;
    let sameFile = group.every((item) => item.suffix === first.suffix);
    if (!sameFile) {
      let insensitive = insensitiveDirectories.get(first.directory);
      if (insensitive === undefined) {
        insensitive = await isCaseInsensitiveDirectory(first.directory);
        insensitiveDirectories.set(first.directory, insensitive);
      }
      sameFile = insensitive;
    }
    for (const item of group) grouped.set(item.filePath, sameFile ? first.filePath : item.filePath);
  }
  return grouped;
}

async function existingParent(filePath: string) {
  let directory = path.dirname(filePath);
  for (;;) {
    try {
      const info = await stat(directory, { bigint: true });
      if (!info.isDirectory()) throw new Error('File change parent is not a directory.');
      return { directory, info };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(directory) === directory) throw error;
      directory = path.dirname(directory);
    }
  }
}

async function isCaseInsensitiveDirectory(directory: string): Promise<boolean> {
  // Only ambiguous batches need a probe. The parent, not process.platform, owns
  // casing semantics (including Windows directories with case sensitivity enabled).
  const probe = path.join(directory, `.setsuna-case-A-${randomUUID()}`);
  const handle = await open(probe, 'wx', 0o600);
  try {
    const actual = await handle.stat({ bigint: true });
    const alias = await stat(path.join(directory, path.basename(probe).toLowerCase()), { bigint: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    return alias?.dev === actual.dev && alias.ino === actual.ino;
  } finally {
    await handle.close();
    await unlink(probe);
  }
}
