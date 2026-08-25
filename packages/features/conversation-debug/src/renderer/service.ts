import type {
  ConversationDebugEventPage,
  ConversationDebugSettingsState,
  RuntimeDebugTraceList,
} from '../contracts/index.js';
import type { ConversationDebugClient } from './client.js';

export type ConversationDebugRendererSnapshot = Readonly<{
  enabled: boolean;
  error: string | null;
  loading: boolean;
  saving: boolean;
  settings: ConversationDebugSettingsState | null;
}>;

export interface ConversationDebugRendererService {
  readonly snapshot: () => ConversationDebugRendererSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  setEnabled(enabled: boolean): Promise<boolean>;
  listEvents(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ConversationDebugEventPage>;
  listTraces(threadId: string, afterSeq?: number): Promise<RuntimeDebugTraceList>;
}

const INITIAL_SNAPSHOT: ConversationDebugRendererSnapshot = Object.freeze({
  enabled: false,
  error: null,
  loading: true,
  saving: false,
  settings: null,
});

export class RuntimeConversationDebugRendererService implements ConversationDebugRendererService {
  private currentSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly client: ConversationDebugClient) {}

  readonly snapshot = (): ConversationDebugRendererSnapshot => this.currentSnapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    const generation = ++this.generation;
    void this.client.readSettings()
      .then((settings) => {
        if (generation === this.generation) this.applySettings(settings);
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.update({ error: errorMessage(error) });
      })
      .finally(() => {
        if (generation === this.generation) this.update({ loading: false });
      });
  }

  dispose(): void {
    this.generation += 1;
    this.listeners.clear();
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    const settings = this.currentSnapshot.settings;
    if (!settings || this.currentSnapshot.saving) return false;
    this.update({ error: null, saving: true });
    try {
      this.applySettings(await this.client.updateSettings({
        expectedRevision: settings.revision,
        patch: { enabled },
      }));
      return true;
    } catch (error) {
      this.update({ error: errorMessage(error) });
      return false;
    } finally {
      this.update({ saving: false });
    }
  }

  listEvents(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ConversationDebugEventPage> {
    return this.client.listEvents(threadId, input, options);
  }

  listTraces(threadId: string, afterSeq = 0): Promise<RuntimeDebugTraceList> {
    return this.client.listTraces(threadId, afterSeq);
  }

  private applySettings(settings: ConversationDebugSettingsState): void {
    this.update({
      enabled: settings.value.enabled,
      error: null,
      settings,
    });
  }

  private update(patch: Partial<ConversationDebugRendererSnapshot>): void {
    this.currentSnapshot = Object.freeze({ ...this.currentSnapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
}

export function createNoopConversationDebugRendererService(): ConversationDebugRendererService {
  const snapshot = Object.freeze({ ...INITIAL_SNAPSHOT, loading: false });
  return Object.freeze({
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
    setEnabled: async () => false,
    listEvents: async (
      _threadId: string,
      input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
    ) => Object.freeze({
      records: Object.freeze([]),
      throughSeq: input.throughSeq,
    }),
    listTraces: async () => Object.freeze({ nextSeq: 1, traces: Object.freeze([]) }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
