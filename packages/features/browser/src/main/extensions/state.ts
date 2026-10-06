import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validExtensionId } from './metadata.js';

/** Only the disabled IDs are persisted; extension files and storage stay in place. */
export class BrowserExtensionState {
  private disabled = new Set<string>();
  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.disabled) || !data.disabled.every(validExtensionId)) {
        throw new Error('Invalid extension state.');
      }
      this.disabled = new Set(data.disabled);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  isEnabled(id: string): boolean { return !this.disabled.has(id); }

  // The service serializes all installation mutations before calling this store.
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!validExtensionId(id)) throw new Error('Invalid extension ID.');
    if (this.isEnabled(id) === enabled) return;
    const next = new Set(this.disabled);
    if (enabled) next.delete(id); else next.add(id);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, disabled: [...next] }), { mode: 0o600 });
      await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
    this.disabled = next;
  }
}
