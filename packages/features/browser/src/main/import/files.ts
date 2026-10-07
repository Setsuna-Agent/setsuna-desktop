import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

export function withinDirectory(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Only read bounded, regular files belonging to the selected browser profile. */
export async function readImportFile(file: string, root?: string): Promise<string> {
  const location = await realpath(file);
  if (root && !withinDirectory(await realpath(root), location)) throw new Error('Invalid browser import path.');
  const handle = await open(location, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Invalid browser import file.');
    return (await handle.readFile('utf8')).replace(/^\uFEFF/, '');
  } finally { await handle.close(); }
}

export async function readProfileJson(root: string, name: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readImportFile(path.join(root, name), root));
    if (!isRecord(value)) throw new Error('Invalid browser profile data.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
