import type { RuntimeTaskKind } from '@setsuna-desktop/contracts';
import { RuntimeTurnInputQueue } from './turn-input-queue.js';

export type RuntimeTurnTask = {
  acceptingSteers: boolean;
  controller: AbortController;
  done?: Promise<unknown>;
  inputQueue: RuntimeTurnInputQueue;
  taskKind: RuntimeTaskKind;
  threadId: string;
  turnId: string;
};

export type RuntimeTurnTaskStartInput = {
  acceptingSteers: boolean;
  taskKind: RuntimeTaskKind;
  threadId: string;
  turnId: string;
};

export type RuntimeTurnTaskRun<T = void> = {
  done: Promise<T>;
  task: RuntimeTurnTask;
  turnId: string;
};

export class RuntimeTurnTaskRegistry {
  private readonly tasksByKey = new Map<string, RuntimeTurnTask>();
  private readonly tasksByThread = new Map<string, RuntimeTurnTask>();

  start(input: RuntimeTurnTaskStartInput): RuntimeTurnTask {
    const active = this.activeForThread(input.threadId);
    if (active) {
      throw new Error(`thread ${input.threadId} already has active ${active.taskKind} turn ${active.turnId}`);
    }
    const task: RuntimeTurnTask = {
      acceptingSteers: input.acceptingSteers,
      controller: new AbortController(),
      inputQueue: new RuntimeTurnInputQueue(),
      taskKind: input.taskKind,
      threadId: input.threadId,
      turnId: input.turnId,
    };
    this.tasksByKey.set(turnTaskKey(input.threadId, input.turnId), task);
    this.tasksByThread.set(input.threadId, task);
    return task;
  }

  run<T = void>(input: RuntimeTurnTaskStartInput, runner: (task: RuntimeTurnTask) => Promise<T>): RuntimeTurnTaskRun<T> {
    const task = this.start(input);
    const done = runner(task).finally(() => this.finish(task));
    task.done = done;
    return { done, task, turnId: task.turnId };
  }

  finish(task: RuntimeTurnTask): void {
    const key = turnTaskKey(task.threadId, task.turnId);
    if (this.tasksByKey.get(key) === task) this.tasksByKey.delete(key);
    if (this.tasksByThread.get(task.threadId) === task) this.tasksByThread.delete(task.threadId);
  }

  activeForThread(threadId: string): RuntimeTurnTask | null {
    const task = this.tasksByThread.get(threadId);
    if (!task || task.controller.signal.aborted) return null;
    return task;
  }

  taskFor(threadId: string, turnId: string): RuntimeTurnTask | null {
    const task = this.tasksByKey.get(turnTaskKey(threadId, turnId));
    if (!task || task.controller.signal.aborted) return null;
    return task;
  }

  cancel(threadId: string, turnId: string, reason?: unknown): boolean {
    const task = this.tasksByKey.get(turnTaskKey(threadId, turnId));
    if (!task || task.controller.signal.aborted) return false;
    if (task.done) void task.done.catch(() => undefined);
    task.controller.abort(reason);
    return true;
  }

  activeTasks(): RuntimeTurnTask[] {
    return [...this.tasksByKey.values()].filter((task) => !task.controller.signal.aborted);
  }

  cancelAll(reason?: unknown): RuntimeTurnTask[] {
    const cancelled: RuntimeTurnTask[] = [];
    for (const task of this.tasksByKey.values()) {
      if (task.controller.signal.aborted) continue;
      if (task.done) void task.done.catch(() => undefined);
      task.controller.abort(reason);
      cancelled.push(task);
    }
    return cancelled;
  }

  async drain(timeoutMs: number): Promise<boolean> {
    const tasks = [...this.tasksByKey.values()];
    if (!tasks.length) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.allSettled(tasks.map((task) => task.done ?? Promise.resolve())).then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  stopAcceptingSteers(threadId: string, turnId: string): void {
    const task = this.activeForThread(threadId);
    if (!task || task.turnId !== turnId) return;
    task.acceptingSteers = false;
  }

  async waitForFinalizingRegularTurn(threadId: string): Promise<void> {
    const active = this.activeForThread(threadId);
    if (active?.taskKind !== 'regular' || active.acceptingSteers || !active.done) return;
    await active.done.catch(() => undefined);
  }
}

function turnTaskKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}
