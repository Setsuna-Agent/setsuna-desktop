import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { automationStateCodec, type AutomationState } from '../contracts/index.js';

/** Only the service's serial mutation queue writes this document. */
export class AutomationStore {
  private readonly file: string;
  constructor(dataDir: string) { this.file = path.join(dataDir, 'features', 'automation', 'tasks.json'); }

  async read(): Promise<AutomationState> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { tasks: [] }; throw error; }
    const document = JSON.parse(raw) as Record<string, unknown>;
    if (document.schemaVersion !== 1) throw new Error('Unsupported automation storage version.');
    return automationStateCodec.parse(document);
  }

  async write(state: AutomationState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, ...state }, null, 2), 'utf8');
    await rename(temporary, this.file);
  }
}
