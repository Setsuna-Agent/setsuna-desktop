import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { assistantsStateCodec, type AssistantsState } from '../contracts/index.js';

const SCHEMA_VERSION = 1;

export function emptyAssistantsState(): AssistantsState {
  return { assistants: [], conversations: [], peers: [], tasks: [], reminders: [], deliveries: [], inbox: [] };
}

export type AssistantsTransaction = {
  /** Working copy; changes become durable on commit or when the mutation finishes. */
  state: AssistantsState;
  /** Persist an intermediate step before a side effect that must not be replayed. */
  commit(): Promise<void>;
};

/**
 * Single writer for the assistants document. Every mutation runs serially on a cloned draft so
 * readers only ever see committed state, and maintenance can drain writes before snapshots.
 */
export class AssistantsStateStore {
  private state = emptyAssistantsState();
  private pending: Promise<unknown> = Promise.resolve();
  private pendingMutations = 0;
  private maintenancePaused = false;
  private stopped = false;
  private readonly file: string;
  private readonly listeners = new Set<(state: Readonly<AssistantsState>) => void>();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'features', 'assistants', 'state.json');
  }

  async load(): Promise<void> {
    let raw: string | null = null;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (raw !== null) {
      const document = JSON.parse(raw) as Record<string, unknown>;
      if (document.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported assistants storage version.');
      this.state = assistantsStateCodec.parse(document);
    }
    this.notify();
  }

  /** Committed state. Callers must not mutate it; use mutate() instead. */
  get current(): Readonly<AssistantsState> { return this.state; }

  /** Observers run after each durable commit, e.g. to refresh in-memory routing indexes. */
  onCommit(listener: (state: Readonly<AssistantsState>) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  mutate<T>(work: (transaction: AssistantsTransaction) => Promise<T> | T): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Assistants service is stopped.'));
    if (this.maintenancePaused) return Promise.reject(new FeatureOperationFailure({ code: 'RUNTIME_MAINTENANCE', message: 'Runtime maintenance is in progress.', retryable: true }));
    // Count queued work at admission so maintenance readiness cannot overtake a durable write.
    this.pendingMutations += 1;
    const result = this.pending.then(async () => {
      const draft = structuredClone(this.state);
      const value = await work({ state: draft, commit: () => this.write(draft) });
      await this.write(draft);
      return value;
    }).finally(() => { this.pendingMutations -= 1; });
    this.pending = result.catch(() => undefined);
    return result;
  }

  /** Resolves after every mutation admitted so far has settled. */
  async settled(): Promise<void> { await this.pending; }

  pendingMutationCount(): number { return this.pendingMutations; }

  isMaintenancePaused(): boolean { return this.maintenancePaused; }

  setMaintenancePaused(paused: boolean): void { this.maintenancePaused = paused; }

  async dispose(): Promise<void> {
    this.stopped = true;
    await this.pending;
  }

  private async write(state: AssistantsState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...state }, null, 2), 'utf8');
    await rename(temporary, this.file);
    this.state = structuredClone(state);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
