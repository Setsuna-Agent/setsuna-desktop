import {
  assistantSidebarUpdateCodec, isActiveTask, type AssistantSidebarPatch, type AssistantSidebarTarget,
  type AssistantsState,
} from '../contracts/index.js';
import { failure } from './directory.js';
import { cancelReminderDeliveries } from './reminders.js';
import type { AssistantsStateStore } from './state-store.js';

/** Entries own their labels and pin state; transcripts stay owned by Core. */
export class AssistantSidebarEntries {
  constructor(private readonly store: AssistantsStateStore) {}

  async update(input: AssistantSidebarTarget & AssistantSidebarPatch): Promise<{ ok: true }> {
    const change = assistantSidebarUpdateCodec.parse(input);
    await this.store.mutate(({ state }) => {
      const task = ownedEntry(state, change);
      if (!task) throw failure('ASSISTANT_NOT_FOUND', '任务不存在。');
      if (change.title !== undefined) task.title = change.title;
      if (change.pinned === true) task.pinned = true;
      else if (change.pinned === false) delete task.pinned;
    });
    return { ok: true };
  }

  async delete(target: AssistantSidebarTarget): Promise<{ ok: true }> {
    await this.store.mutate(({ state }) => {
      if (!ownedEntry(state, target)) return;
      if (target.kind === 'reminder') {
        cancelReminderDeliveries(state, target.entryId);
        state.reminders = state.reminders.filter((item) => item.id !== target.entryId);
        return;
      }
      const task = state.tasks.find((item) => item.id === target.entryId)!;
      if (isActiveTask(task)) throw failure('ASSISTANT_BUSY', '请先等待或取消这个任务。');
      state.tasks = state.tasks.filter((item) => item.id !== target.entryId);
    });
    return { ok: true };
  }
}

function ownedEntry(state: AssistantsState, target: AssistantSidebarTarget) {
  if (!state.assistants.some((assistant) => assistant.id === target.assistantId)) throw failure('ASSISTANT_NOT_FOUND', '助理不存在。');
  const task = (target.kind === 'reminder' ? state.reminders : state.tasks).find((item) => item.id === target.entryId);
  if (task && task.assistantId !== target.assistantId) throw failure('ASSISTANT_NOT_FOUND', '任务不存在。');
  return task;
}
