import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Extension } from 'electron';
import type { UserScriptSource, UserScriptsState } from '../../../contracts/user-script-types.js';
import { validExtensionId } from '../metadata.js';
import { parseUserScriptsState, serializeUserScriptsState, emptyUserScriptsState } from './model.js';

/** Registrations survive worker suspension, disabled extensions and application restarts. */
export class UserScriptStore {
  constructor(private readonly directory: string) {}
  read(id: string): UserScriptsState {
    if (!validExtensionId(id)) throw new Error('Invalid extension ID.');
    try { return parseUserScriptsState(readFileSync(path.join(this.directory, `${id}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return emptyUserScriptsState(); }
  }
  async write(id: string, state: UserScriptsState): Promise<void> {
    if (!validExtensionId(id)) throw new Error('Invalid extension ID.');
    const file = path.join(this.directory, `${id}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await mkdir(this.directory, { recursive: true });
    try {
      await writeFile(temporary, serializeUserScriptsState(state), { mode: 0o600 });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }
  async remove(id: string): Promise<void> {
    if (!validExtensionId(id)) throw new Error('Invalid extension ID.');
    await rm(path.join(this.directory, `${id}.json`), { force: true });
  }
}

export function scriptSources(extension: Extension, sources: UserScriptSource[]): string[] {
  return sources.map((source) => {
    if ('code' in source) return source.code;
    try {
      const root = realpathSync(extension.path);
      const requested = path.resolve(root, source.file);
      // Check before looking up a path, then again after symlink resolution. Neither traversal
      // nor Windows drive paths may read host files or expose their filesystem errors.
      if (!within(root, requested)) throw new Error();
      const file = realpathSync(requested);
      if (!within(root, file)) throw new Error();
      const info = statSync(file);
      if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error();
      const relative = path.relative(root, file);
      return `${readFileSync(file, 'utf8')}\n//# sourceURL=chrome-extension://${extension.id}/${relative.split(path.sep).join('/')}`;
    } catch { throw new Error(`Could not load javascript '${source.file}' for script.`); }
  });
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
