import type { RuntimeTaskKind } from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeEventWriter } from './runtime-event-writer.js';

const TURN_ABORTED_MODEL_GUIDANCE = [
  '<turn_aborted>',
  'The user interrupted the previous turn on purpose. Any running shell commands may still be running in the background. If any tools or commands were aborted, they may have partially executed.',
  '</turn_aborted>',
].join('\n');

type RuntimeTurnTerminationCoordinatorOptions = {
  clock: Clock;
  eventWriter: Pick<RuntimeEventWriter, 'flushThread'>;
  ids: IdGenerator;
  threadStore: ThreadStore;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** 串行写入终止取消状态，确保每个轮次最多产生一个终止事件。 */
export class RuntimeTurnTerminationCoordinator {
  private readonly pendingTerminalWrites = new Map<string, { promise: Promise<boolean>; threadId: string }>();

  constructor(private readonly options: RuntimeTurnTerminationCoordinatorOptions) {}

  async publishCancelledOnce(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    reason: string,
    options: { marker?: boolean } = {},
  ): Promise<boolean> {
    const key = `${threadId}:${turnId}`;
    const existing = this.pendingTerminalWrites.get(key);
    if (existing) {
      await existing.promise;
      return false;
    }
    const promise = this.publishCancellation(threadId, turnId, taskKind, reason, options);
    this.pendingTerminalWrites.set(key, { promise, threadId });
    try {
      return await promise;
    } finally {
      if (this.pendingTerminalWrites.get(key)?.promise === promise) this.pendingTerminalWrites.delete(key);
    }
  }

  /** Waits for cancellation writes that may outlive the caller that first aborted the task. */
  async waitForThread(threadId: string): Promise<void> {
    for (;;) {
      const pending = [...this.pendingTerminalWrites.values()]
        .filter((entry) => entry.threadId === threadId)
        .map((entry) => entry.promise);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  private async publishCancellation(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    reason: string,
    options: { marker?: boolean },
  ): Promise<boolean> {
    await this.options.eventWriter.flushThread(threadId);
    if (await this.hasTerminalEvent(threadId, turnId)) return false;
    if (options.marker) await this.publishAbortedMarker(threadId, turnId);
    if (await this.hasTerminalEvent(threadId, turnId)) return false;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.cancelled',
      createdAt: this.options.clock.now().toISOString(),
      payload: { reason, taskKind },
    });
    return true;
  }

  private async publishAbortedMarker(threadId: string, turnId: string): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'message.created',
      createdAt,
      payload: {
        message: {
          id: this.options.ids.id('msg'),
          turnId,
          role: 'user',
          content: TURN_ABORTED_MODEL_GUIDANCE,
          createdAt,
          status: 'complete',
          visibility: 'model',
        },
      },
    });
  }

  private async hasTerminalEvent(threadId: string, turnId: string): Promise<boolean> {
    const events = await this.options.threadStore.listEvents(threadId, 0);
    return events.some((event) =>
      event.turnId === turnId
      && (event.type === 'turn.cancelled' || event.type === 'turn.completed' || event.type === 'runtime.error')
    );
  }
}
