import { cloneMessage, cloneThreadTurn } from '../thread-event-projection.js';
import {
  normalizeRuntimeQueuedTurnInputKind,
  type RuntimeMessage,
  type RuntimeQueuedTurnInput,
  type RuntimeThread,
  type RuntimeThreadTurn,
} from '../threads.js';

/**
 * Copy-on-write facade for one event projection. Arrays are copied only when their
 * domain changes, and nested records are cloned only when a reducer will mutate them.
 */
export class RuntimeThreadEventDraft {
  readonly thread: RuntimeThread;
  private messagesCopied = false;
  private turnsCopied = false;
  private readonly mutableMessages = new WeakSet<RuntimeMessage>();
  private readonly mutableTurns = new WeakSet<RuntimeThreadTurn>();

  constructor(source: RuntimeThread, lastSeq: number, updatedAt: string) {
    this.thread = {
      ...source,
      queuedTurnInputs: normalizeQueuedTurnInputs(source.queuedTurnInputs),
      lastSeq,
      updatedAt,
    };
  }

  prepareMessageAppend(): void {
    this.copyMessages();
  }

  mutableMessage(message: RuntimeMessage | undefined): RuntimeMessage | undefined {
    if (!message) return undefined;
    const index = this.thread.messages.indexOf(message);
    if (index < 0) return this.mutableMessageById(message.id);
    this.copyMessages();
    return this.mutableMessageAt(index);
  }

  mutableMessageById(messageId: string): RuntimeMessage | undefined {
    const index = this.thread.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return undefined;
    this.copyMessages();
    return this.mutableMessageAt(index);
  }

  mutableMessagesForTurn(turnId: string | undefined): RuntimeMessage[] {
    const indexes: number[] = [];
    for (let index = 0; index < this.thread.messages.length; index += 1) {
      const message = this.thread.messages[index];
      if (message && (!turnId || message.turnId === turnId)) indexes.push(index);
    }
    if (!indexes.length) return [];
    this.copyMessages();
    return indexes.map((index) => this.mutableMessageAt(index));
  }

  mutableTurn(turnId: string | undefined, createdAt: string): RuntimeThreadTurn | null {
    if (!turnId) return null;
    this.copyTurns();
    const turns = this.thread.turns ?? [];
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index < 0) {
      const turn: RuntimeThreadTurn = {
        id: turnId,
        items: [],
        startedAt: createdAt,
        status: 'in_progress',
      };
      turns.push(turn);
      this.mutableTurns.add(turn);
      return turn;
    }
    const current = turns[index];
    if (!current || this.mutableTurns.has(current)) return current ?? null;
    const mutable = cloneThreadTurn(current);
    turns[index] = mutable;
    this.mutableTurns.add(mutable);
    return mutable;
  }

  private mutableMessageAt(index: number): RuntimeMessage {
    const current = this.thread.messages[index];
    if (!current) throw new Error(`Missing runtime message at index ${index}.`);
    if (this.mutableMessages.has(current)) return current;
    const mutable = cloneMessage(current);
    this.thread.messages[index] = mutable;
    this.mutableMessages.add(mutable);
    return mutable;
  }

  private copyMessages(): void {
    if (this.messagesCopied) return;
    this.thread.messages = [...this.thread.messages];
    this.messagesCopied = true;
  }

  private copyTurns(): void {
    if (this.turnsCopied) return;
    this.thread.turns = [...(this.thread.turns ?? [])];
    this.turnsCopied = true;
  }
}

function normalizeQueuedTurnInputs(
  inputs: RuntimeQueuedTurnInput[] | undefined,
): RuntimeQueuedTurnInput[] | undefined {
  if (!inputs) return undefined;
  let normalized = inputs;
  for (const [index, input] of inputs.entries()) {
    const kind = normalizeRuntimeQueuedTurnInputKind(input.kind);
    if (input.kind === kind) continue;
    if (normalized === inputs) normalized = [...inputs];
    normalized[index] = { ...input, kind };
  }
  return normalized;
}
