import type { PendingStoredThreadEvent, RuntimeMessage } from '@setsuna-desktop/contracts';
import { createFeatureEvent } from '@setsuna-desktop/feature-core/events';
import type { FeatureProjectionStore } from '@setsuna-desktop/feature-core/runtime';
import {
  collaborationExecutionChangedEvent, collaborationTaskCreatedEvent, isTerminalCollaborationTaskStatus,
  type CollaborationExecution, type CollaborationRuntimeHost, type CollaborationState, type CollaborationTask,
} from '../contracts/index.js';
import { childAgentOutput, resultContextMessage, MAX_COLLABORATION_RESULTS_PER_DELIVERY } from './collaboration-results.js';

/** Serializes small ledger transactions, never turn execution or waits. */
export class CollaborationLedger {
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Map<string, Set<() => void>>();
  readonly starting = new Set<string>();

  constructor(
    private readonly host: CollaborationRuntimeHost,
    private readonly projection: FeatureProjectionStore<CollaborationState>,
  ) {}

  read(parentThreadId: string) { return this.projection.read(parentThreadId); }

  revision(parentThreadId: string): number { return this.revisions.get(parentThreadId) ?? 0; }

  waitForChange(parentThreadId: string, revision: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.revision(parentThreadId) !== revision) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const listeners = this.listeners.get(parentThreadId) ?? new Set<() => void>();
      this.listeners.set(parentThreadId, listeners);
      const cleanup = () => {
        listeners.delete(ready);
        if (!listeners.size) this.listeners.delete(parentThreadId);
        signal.removeEventListener('abort', abort);
      };
      const ready = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      listeners.add(ready);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async register(parentThreadId: string, task: CollaborationTask, execution: CollaborationExecution, newTask: boolean): Promise<void> {
    await this.mutate(parentThreadId, async () => {
      const events: PendingStoredThreadEvent[] = newTask ? [createFeatureEvent(collaborationTaskCreatedEvent, {
        id: this.host.id('event'), threadId: parentThreadId, turnId: execution.parentTurnId, createdAt: task.createdAt,
      }, task)] : [];
      events.push(this.executionEvent(parentThreadId, execution));
      await this.append(parentThreadId, events);
    });
  }

  async update(parentThreadId: string, turnId: string, patch: Partial<Pick<CollaborationExecution, 'status' | 'error' | 'resultPreview' | 'delivery'>>): Promise<void> {
    await this.mutate(parentThreadId, async () => {
      const execution = (await this.read(parentThreadId)).state.executions.find((entry) => entry.turnId === turnId);
      if (!execution) return;
      if (patch.status && isTerminalCollaborationTaskStatus(execution.status)) return;
      if (patch.delivery && execution.delivery !== 'pending') return;
      if (Object.entries(patch).every(([key, value]) => execution[key as keyof CollaborationExecution] === value)) return;
      await this.append(parentThreadId, [this.executionEvent(parentThreadId, {
        ...execution, ...patch, updatedAt: this.host.now().toISOString(),
      })]);
    });
  }

  /** Only the requested parent is repaired. No global scan is required at startup. */
  async reconcile(parentThreadId: string): Promise<void> {
    await this.mutate(parentThreadId, async () => {
      const snapshot = await this.read(parentThreadId);
      const executions = [...snapshot.state.executions];
      const events: PendingStoredThreadEvent[] = [];
      for (const task of snapshot.state.tasks) {
        if (executions.some((entry) => entry.taskId === task.id)) continue;
        // Old ledgers have no delivery receipt. Recover once conservatively rather than lose output.
        const execution: CollaborationExecution = {
          taskId: task.id, turnId: task.activeTurnId ?? `legacy_${task.id}`,
          status: task.status, delivery: 'pending',
          createdAt: task.createdAt, updatedAt: task.updatedAt,
          ...(task.error ? { error: task.error } : {}),
          ...(task.resultPreview ? { resultPreview: task.resultPreview } : {}),
        };
        executions.push(execution);
        events.push(this.executionEvent(parentThreadId, execution));
      }
      for (const execution of executions) {
        if (isTerminalCollaborationTaskStatus(execution.status) || this.starting.has(execution.turnId)) continue;
        const task = snapshot.state.tasks.find((candidate) => candidate.id === execution.taskId)!;
        if (this.host.activeTask(task.childThreadId)?.turnId === execution.turnId) continue;
        const child = await this.host.getThread(task.childThreadId);
        const turn = child?.turns?.find((candidate) => candidate.id === execution.turnId);
        const status = turn?.status && turn.status !== 'in_progress' ? turn.status : 'interrupted';
        const output = childAgentOutput(child, execution.turnId);
        events.push(this.executionEvent(parentThreadId, {
          ...execution, status, updatedAt: this.host.now().toISOString(),
          ...(turn?.error ? { error: turn.error } : {}),
          ...(output ? { resultPreview: output.slice(0, 240) } : {}),
        }));
      }
      if (events.length) await this.append(parentThreadId, events);
    });
  }

  async deliver(parentThreadId: string, parentTurnId: string, turnIds: readonly string[], signal: AbortSignal): Promise<RuntimeMessage[]> {
    return this.mutate(parentThreadId, async () => {
      signal.throwIfAborted();
      const { state } = await this.read(parentThreadId);
      const messages: RuntimeMessage[] = [];
      const events: PendingStoredThreadEvent[] = [];
      for (const execution of state.executions) {
        if (messages.length >= MAX_COLLABORATION_RESULTS_PER_DELIVERY) break;
        if (!turnIds.includes(execution.turnId) || execution.delivery !== 'pending' || !isTerminalCollaborationTaskStatus(execution.status)) continue;
        const task = state.tasks.find((candidate) => candidate.id === execution.taskId)!;
        const child = await this.host.getThread(task.childThreadId);
        const createdAt = this.host.now().toISOString();
        const message = resultContextMessage(task, execution, child, parentTurnId, createdAt);
        messages.push(message);
        // The model context and receipt commit together. A crash cannot acknowledge a lost result.
        events.push({ id: this.host.id('event'), threadId: parentThreadId, turnId: parentTurnId,
          type: 'message.created', createdAt, payload: { message } });
        events.push(this.executionEvent(parentThreadId, {
          ...execution, delivery: 'delivered', deliveredToTurnId: parentTurnId, updatedAt: createdAt,
        }));
      }
      signal.throwIfAborted();
      if (events.length) await this.append(parentThreadId, events);
      return messages;
    });
  }

  private executionEvent(parentThreadId: string, execution: CollaborationExecution): PendingStoredThreadEvent {
    return createFeatureEvent(collaborationExecutionChangedEvent, {
      id: this.host.id('event'), threadId: parentThreadId, turnId: execution.parentTurnId, createdAt: execution.updatedAt,
    }, execution);
  }

  private async append(parentThreadId: string, events: readonly PendingStoredThreadEvent[]): Promise<void> {
    await this.host.appendEvents(parentThreadId, events);
    this.revisions.set(parentThreadId, this.revision(parentThreadId) + 1);
    this.listeners.get(parentThreadId)?.forEach((ready) => ready());
  }

  private async mutate<T>(parentThreadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(parentThreadId) ?? Promise.resolve();
    const run = previous.then(operation);
    const settled = run.catch(() => undefined);
    this.writes.set(parentThreadId, settled);
    try { return await run; }
    finally { if (this.writes.get(parentThreadId) === settled) this.writes.delete(parentThreadId); }
  }
}
