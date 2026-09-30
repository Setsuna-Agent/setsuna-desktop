import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import type { AutomationDraft, AutomationModel, AutomationRun, AutomationSchedule, AutomationSnapshot, AutomationState, AutomationTask } from './types.js';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, limit = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label} is required (maximum ${limit} characters).`);
  return value.trim();
}

export function identity(value: unknown): string {
  const id = text(value, 'id');
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error('Invalid id.');
  return id;
}

export function timestamp(value: unknown): string {
  const at = text(value, 'timestamp');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(at);
  if (!parts || !Number.isFinite(Date.parse(at)) || new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))).toISOString().slice(0, 10) !== at.slice(0, 10)) throw new Error('Use a valid ISO timestamp with a timezone.');
  return new Date(at).toISOString();
}

export const automationScheduleCodec = defineRuntimeCodec<AutomationSchedule>((value) => {
  const input = record(value);
  if (input.kind === 'once') return { kind: 'once', at: timestamp(input.at) };
  if (input.kind === 'interval') {
    if (!Number.isInteger(input.minutes) || Number(input.minutes) < 1 || Number(input.minutes) > 525_600) throw new Error('Interval must be 1–525600 minutes.');
    return { kind: 'interval', minutes: Number(input.minutes) };
  }
  if (!['daily', 'weekdays', 'weekly', 'custom'].includes(String(input.kind))) throw new Error('Invalid repeat rule.');
  const time = text(input.time, 'time');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) throw new Error('Time must use HH:mm.');
  // Keep calendar metadata internally; user-facing inputs only need a local clock time.
  const timeZone = input.timeZone === undefined ? Intl.DateTimeFormat().resolvedOptions().timeZone : text(input.timeZone, 'timeZone');
  new Intl.DateTimeFormat('en', { timeZone }).format();
  if (input.kind === 'daily' || input.kind === 'weekdays') return { kind: input.kind, time, timeZone };
  if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Choose weekdays from 0 (Sunday) to 6 (Saturday).');
  const weekdays = [...new Set(input.weekdays as number[])].sort();
  if (input.kind === 'weekly' && weekdays.length !== 1) throw new Error('Weekly schedules require one weekday.');
  return { kind: input.kind as 'weekly' | 'custom', time, timeZone, weekdays };
});

export const automationDraftCodec = defineRuntimeCodec<AutomationDraft>((value) => {
  const input = record(value);
  if (input.newChat !== undefined && typeof input.newChat !== 'boolean') throw new Error('newChat must be boolean.');
  const model = input.modelSelection === undefined ? undefined : record(input.modelSelection);
  return {
    title: text(input.title, 'title', 120), prompt: text(input.prompt, 'prompt', 32_000),
    schedule: automationScheduleCodec.parse(input.schedule), newChat: input.newChat === true,
    ...(input.projectId !== undefined ? { projectId: input.projectId === null ? null : identity(input.projectId) } : {}),
    ...(model ? { modelSelection: { providerId: text(model.providerId, 'providerId'), modelId: text(model.modelId, 'modelId') } } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: text(input.thinkingEffort, 'thinkingEffort', 32) } : {}),
  };
});

export const automationTaskCodec = defineRuntimeCodec<AutomationTask>((value) => {
  const input = record(value);
  if (!['active', 'paused', 'completed'].includes(String(input.status)) || !Array.isArray(input.runs)) throw new Error('Invalid automation state.');
  return {
    ...automationDraftCodec.parse(input), id: identity(input.id), conversationThreadId: identity(input.conversationThreadId),
    ...(input.executionThreadId ? { executionThreadId: identity(input.executionThreadId) } : {}),
    status: input.status as AutomationTask['status'], nextRunAt: input.nextRunAt === null ? null : timestamp(input.nextRunAt),
    createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt), runs: input.runs.map(parseRun),
  };
});

function parseRun(value: unknown): AutomationRun {
  const input = record(value);
  if (!['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(input.status))) throw new Error('Invalid automation run status.');
  return {
    id: identity(input.id), threadId: identity(input.threadId), scheduledFor: timestamp(input.scheduledFor), startedAt: timestamp(input.startedAt),
    status: input.status as AutomationRun['status'], ...(input.turnId ? { turnId: identity(input.turnId) } : {}),
    ...(input.finishedAt ? { finishedAt: timestamp(input.finishedAt) } : {}), ...(input.error ? { error: text(input.error, 'error', 4_000) } : {}),
  };
}

export const automationStateCodec = defineRuntimeCodec<AutomationState>((value) => {
  const input = record(value);
  if (!Array.isArray(input.tasks)) throw new Error('Tasks must be an array.');
  const tasks = input.tasks.map((task) => automationTaskCodec.parse(task));
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error('Duplicate task id.');
  return { tasks, ...(input.draftThreadId ? { draftThreadId: identity(input.draftThreadId) } : {}) };
});

export const automationSnapshotCodec = defineRuntimeCodec<AutomationSnapshot>((value) => {
  const input = record(value);
  if (!Array.isArray(input.models) || !Array.isArray(input.projects)) throw new Error('Models and projects must be arrays.');
  const models: AutomationModel[] = input.models.map((value) => {
    const model = record(value);
    if (!Array.isArray(model.thinkingEfforts) || model.thinkingEfforts.some((effort) => typeof effort !== 'string')) throw new Error('Invalid model efforts.');
    return { providerId: text(model.providerId, 'providerId'), modelId: text(model.modelId, 'modelId'), name: text(model.name, 'name'), thinkingEfforts: model.thinkingEfforts as string[] };
  });
  const projects = input.projects.map((value) => {
    const project = record(value);
    return { id: identity(project.id), name: text(project.name, 'name'),
      ...(project.path ? { path: text(project.path, 'path', 32_000) } : {}) };
  });
  return { ...automationStateCodec.parse(input), models, projects };
});
