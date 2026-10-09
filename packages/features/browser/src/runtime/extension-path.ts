import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

/** Local installation reads executable files, so resolve symlinks before checking workspace ownership. */
export async function resolveExtensionDirectory(directory: string, environment?: RuntimeEnvironment): Promise<string> {
  if (!environment) throw new Error('A local workspace is required to install browser extensions.');
  const location = await realpath(path.resolve(environment.workspaceRoot, directory));
  for (const root of environment.workspaceRoots) {
    const canonicalRoot = await realpath(root);
    const relative = path.relative(canonicalRoot, location);
    if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) return location;
  }
  throw new Error('Browser extension directory must be inside the current workspace.');
}
