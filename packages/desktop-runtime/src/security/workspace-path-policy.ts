import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Canonicalize the nearest existing ancestor as well as existing targets (including Windows junctions). */
export function canonicalFilesystemPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      if (lstatSync(resolved).isSymbolicLink()) throw new Error(`Symbolic link target is unavailable: ${resolved}`);
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError;
    }
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(canonicalFilesystemPath(parent), path.basename(resolved));
  }
}

export function pathWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** One unavailable binding must not disable tools in the other project directories. */
export function canonicalFilesystemRoots(roots: string[], base: string): string[] {
  return roots.flatMap((root) => {
    try { return [canonicalFilesystemPath(path.resolve(base, root))]; }
    catch { return []; }
  });
}
