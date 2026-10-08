import type { RuntimeConfigState, RuntimeMessage, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { AutomationSnapshot, AutomationTask } from '@setsuna-desktop/feature-automation/contracts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CREATION_POLICY } from '@setsuna-desktop/feature-automation/runtime';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

const legacyWelcome = '想自动完成什么任务？告诉我任务内容和执行时间，我会帮你安排。';
const legacyPolicy = [
  'You help the user create and edit local scheduled tasks through a friendly conversation.',
  'A scheduled task executes its saved prompt as an unattended agent conversation on this computer.',
  'Use manage_automation to save the task. Do not implement schedules using shell commands, OS cron, or a background sleep.',
  'Ask for missing task content and timing using request_user_input with a short, friendly form and sensible prefilled values.',
  'Relevant fields are title, prompt, repeat rule, time/date, timezone, optional model and thinking effort, and whether each run opens a new chat.',
  'Infer fields already stated by the user; do not ask them to repeat those fields. The default is to reuse the execution chat.',
  'The task runs locally with full access and without user input forms. Keep its prompt self-contained.',
  'After saving, briefly confirm the next run time. Never claim a schedule exists before the tool succeeds.',
].join(' ');

describe('scheduled conversations through the runtime API', () => {
  let harness: RuntimeServerTestHarness;
  beforeEach(async () => {
    // Advance scheduler intervals explicitly while HTTP, file I/O and polling stay real.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    harness = await createRuntimeServerTestHarness();
  });
  afterEach(async () => {
    try { await harness?.close(); } finally { vi.useRealTimers(); }
  });

  it.each(['/v1/data-migration/prepare', '/internal/webdav-sync/prepare'])('preserves overdue one-shot tasks while %s holds the snapshot boundary', async (preparePath) => {
    await harness.configureSmokeProviderContextWindow(32_000);
    const { threadId } = await harness.runtimeFetch('/v1/features/automation/conversations', { method: 'POST' });
    const task = await harness.runtimeFetch('/v1/features/automation/tasks', {
      method: 'POST', body: JSON.stringify({ threadId, draft: {
        title: 'After maintenance', prompt: 'Summarize results', newChat: false,
        schedule: { kind: 'once', at: new Date(Date.now() + 2_000).toISOString() },
      } }),
    }) as AutomationTask;
    await expect.poll(async () => (await harness.runtimeFetch(preparePath, { method: 'POST' })).ready).toBe(true);
    const ledgerPath = path.join(harness.runtimeDataDir, 'runtime', 'features', 'automation', 'tasks.json');
    const before = await readFile(ledgerPath, 'utf8');
    // Cross the registered scheduler tick while preparation holds the write boundary.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await readFile(ledgerPath, 'utf8')).toBe(before);
    await harness.runtimeFetch(preparePath, { method: 'DELETE' });
    let dispatched: AutomationTask | undefined;
    await expect.poll(async () => {
      const snapshot = await harness.runtimeFetch('/v1/features/automation/tasks') as AutomationSnapshot;
      dispatched = snapshot.tasks.find((item) => item.id === task.id);
      return dispatched?.runs.length;
    }, { timeout: 10_000 }).toBe(1);
    expect(dispatched).toMatchObject({ status: 'completed', nextRunAt: null, runs: [{ scheduledFor: task.nextRunAt }] });
    const run = dispatched!.runs[0];
    await harness.waitForThread(run.threadId, (thread) => thread.turns?.some((turn) => turn.id === run.turnId && turn.status === 'completed') ?? false);
  });

  it('reclassifies legacy setup and execution chats while preserving ordinary conversations and transcripts', async () => {
    const project = await addProject(harness);
    await harness.server.close();
    const store = new SqliteThreadStore(path.join(harness.runtimeDataDir, 'runtime'), systemClock, new RandomIdGenerator());
    const ordinary = await store.createThread({ title: '新建定时任务', memoryMode: 'disabled' });
    const manager = await store.createThread({ title: 'Renamed setup', projectId: project.id, memoryMode: 'disabled' });
    const ownedManager = await store.createThread({ title: 'Owned setup', memoryMode: 'disabled', featureId: 'automation' });
    const execution = await store.createThread({ title: 'Existing execution', memoryMode: 'disabled', featureId: 'automation' });
    const globalExecution = await store.createThread({ title: 'Global execution', featureId: 'automation' });
    for (const thread of [manager, ownedManager, execution]) {
      await appendMessage(store, thread, { id: 'seed', role: 'developer', visibility: 'model', content: thread.id === ownedManager.id ? AUTOMATION_CREATION_POLICY : legacyPolicy });
      await appendMessage(store, thread, { id: 'welcome', role: 'assistant', phase: 'final_answer', content: legacyWelcome });
    }
    await appendMessage(store, manager, { id: 'user', role: 'user', turnId: 'real_turn', content: 'Run every day at nine' });
    await appendMessage(store, manager, { id: 'answer', role: 'assistant', turnId: 'real_turn', content: legacyWelcome });
    await appendMessage(store, ordinary, { id: 'ordinary', role: 'assistant', content: legacyWelcome });
    await store.close();
    const directory = path.join(harness.runtimeDataDir, 'runtime', 'features', 'automation');
    await mkdir(directory, { recursive: true });
    const task: AutomationTask = {
      id: 'legacy_task', title: 'Existing task', prompt: 'Summarize results', newChat: false,
      schedule: { kind: 'interval', minutes: 60 }, status: 'paused', nextRunAt: null,
      conversationThreadId: manager.id, executionThreadId: execution.id,
      createdAt: manager.createdAt, updatedAt: manager.updatedAt, runs: [],
    };
    const globalTask = { ...task, id: 'global_task', projectId: null, conversationThreadId: ordinary.id, executionThreadId: globalExecution.id };
    await writeFile(path.join(directory, 'tasks.json'), JSON.stringify({ schemaVersion: 1, tasks: [task, globalTask] }));
    await harness.startRuntimeServer(harness.runtimeDataDir);
    expect((await harness.runtimeFetch('/v1/threads')).threads.map((thread: RuntimeThread) => thread.id).sort())
      .toEqual([ordinary.id, execution.id, globalExecution.id].sort());
    expect((await harness.runtimeFetch(`/v1/threads?scope=project&projectId=${project.id}`)).threads)
      .toMatchObject([{ id: execution.id, projectId: project.id, origin: { featureId: 'automation', entityId: task.id } }]);
    expect((await harness.runtimeFetch('/v1/threads?scope=global')).threads.map((thread: RuntimeThread) => thread.id).sort())
      .toEqual([ordinary.id, globalExecution.id].sort());
    const classified = await harness.runtimeFetch(`/v1/threads/${manager.id}`) as RuntimeThread;
    expect(classified).toMatchObject({ featureId: 'automation' });
    expect(classified.messages.map((message) => message.content)).toEqual([legacyPolicy, 'Run every day at nine', legacyWelcome]);
    expect((await harness.runtimeFetch(`/v1/threads/${ownedManager.id}`)).messages.map((message: RuntimeMessage) => message.content)).toEqual([AUTOMATION_CREATION_POLICY]);
    expect((await harness.runtimeFetch(`/v1/threads/${ordinary.id}`)).messages[0].content).toBe(legacyWelcome);
    const classifiedExecution = await harness.runtimeFetch(`/v1/threads/${execution.id}`) as RuntimeThread;
    expect(classifiedExecution.featureId).toBeUndefined();
    expect(classifiedExecution).toMatchObject({ projectId: project.id, origin: { featureId: 'automation', entityId: task.id } });
    expect(classifiedExecution.messages.map((message) => message.content)).toEqual([legacyPolicy, legacyWelcome]);
    expect((await harness.runtimeFetch('/v1/features/automation/tasks')).tasks[0]).toMatchObject({ id: task.id, conversationThreadId: manager.id });
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    expect(await harness.runtimeFetch(`/v1/threads/${manager.id}`)).toMatchObject({ lastSeq: classified.lastSeq, featureId: 'automation' });
    expect(await harness.runtimeFetch(`/v1/threads/${execution.id}`)).toMatchObject({ lastSeq: classifiedExecution.lastSeq, projectId: project.id, origin: classifiedExecution.origin });
  });

  it('lists all models from enabled providers and runs an edited task with a non-default model', async () => {
    await harness.configureSmokeProviderContextWindow(32_000);
    const config = await harness.runtimeFetch('/v1/config') as RuntimeConfigState;
    const provider = config.providers[0]!;
    const current = { ...provider.models[0]!, thinkingEnabled: true, thinkingEfforts: ['high'] };
    const alternative = { ...current, id: 'alternative', name: 'Alternative model', enabled: false, thinkingEfforts: ['low'] };
    await harness.runtimeFetch('/v1/features/model-provider/settings', {
      method: 'PUT', body: JSON.stringify({ activeProviderId: provider.id, providers: [
        { ...provider, models: [current, alternative] },
        { ...provider, id: 'other', name: 'Other service', models: [current] },
        { ...provider, id: 'disabled', enabled: false, models: [current] },
      ] }),
    });
    const snapshot = await harness.runtimeFetch('/v1/features/automation/tasks') as AutomationSnapshot;
    expect(snapshot.models.map(({ providerId, modelId }) => ({ providerId, modelId }))).toEqual([
      { providerId: provider.id, modelId: current.id }, { providerId: provider.id, modelId: alternative.id },
      { providerId: 'other', modelId: current.id },
    ]);
    const { threadId } = await harness.runtimeFetch('/v1/features/automation/conversations', { method: 'POST' });
    const draft = { title: 'Use alternative model', prompt: 'Summarize the result.', newChat: false, schedule: { kind: 'interval', minutes: 60 } };
    const task = await harness.runtimeFetch('/v1/features/automation/tasks', {
      method: 'POST', body: JSON.stringify({ threadId, draft: { ...draft, thinkingEffort: 'high' } }),
    }) as AutomationTask;
    const modelSelection = { providerId: provider.id, modelId: alternative.id };
    const updated = await harness.runtimeFetch(`/v1/features/automation/tasks/${task.id}`, {
      method: 'PUT', body: JSON.stringify({ draft: { ...draft, modelSelection } }),
    }) as AutomationTask;
    expect(updated.modelSelection).toEqual(modelSelection);
    expect(updated).not.toHaveProperty('thinkingEffort');
    const dispatched = await harness.runtimeFetch(`/v1/features/automation/tasks/${task.id}/run`, { method: 'POST' }) as AutomationTask;
    const run = dispatched.runs[0]!;
    const transcript = await harness.waitForThread(run.threadId, (thread) => thread.turns?.some((turn) => turn.id === run.turnId && turn.status === 'completed') ?? false);
    expect(transcript.turns?.find((turn) => turn.id === run.turnId)?.modelBinding).toMatchObject(modelSelection);
    expect((await harness.runtimeFetch('/v1/config')).providers[0].models.find((model: { enabled: boolean }) => model.enabled).id).toBe(current.id);
  });

  it.each(['project', 'global'] as const)('dispatches into %s chats, retains provenance across restart and task deletion, and manages it through typed routes', async (scope) => {
    await harness.configureSmokeProviderContextWindow(32_000);
    const project = await addProject(harness);
    const { threadId } = await harness.runtimeFetch('/v1/features/automation/conversations', { method: 'POST' });
    expect(await harness.runtimeFetch('/v1/features/automation/conversations', { method: 'POST' })).toEqual({ threadId });
    const manager = await harness.runtimeFetch(`/v1/threads/${threadId}`) as RuntimeThread;
    expect(manager.featureId).toBe('automation');
    expect((await harness.runtimeFetch('/v1/threads')).threads).not.toContainEqual(expect.objectContaining({ id: threadId }));
    expect(manager.messages).toContainEqual(expect.objectContaining({ role: 'developer', visibility: 'model', content: expect.stringContaining('manage_automation') }));
    expect(manager.messages).toHaveLength(1);
    const draft = {
      title: '定时整理', prompt: 'Summarize the scheduled task result.', newChat: false,
      projectId: scope === 'project' ? project.id : null,
      schedule: { kind: 'once', at: new Date(Date.now() + 1_000).toISOString() },
    };
    const task = await harness.runtimeFetch('/v1/features/automation/tasks', {
      method: 'POST', body: JSON.stringify({ threadId, draft }),
    }) as AutomationTask;
    expect(task).toMatchObject({ conversationThreadId: threadId, status: 'active', modelSelection: { providerId: 'local-test', modelId: 'local-runtime-smoke' } });
    const fresh = await harness.runtimeFetch('/v1/features/automation/conversations', { method: 'POST' });
    expect(fresh.threadId).not.toBe(threadId);
    await vi.advanceTimersByTimeAsync(5_000);
    let dispatched: AutomationTask | undefined;
    await expect.poll(async () => {
      const snapshot = await harness.runtimeFetch('/v1/features/automation/tasks') as AutomationSnapshot;
      dispatched = snapshot.tasks.find((item) => item.id === task.id);
      return dispatched?.runs.length;
    }, { timeout: 15_000, interval: 100 }).toBe(1);
    const run = dispatched!.runs[0];
    expect(run.threadId).not.toBe(threadId);
    expect(dispatched).toMatchObject({ status: 'completed', nextRunAt: null });
    const transcript = await harness.waitForThread(run.threadId, (thread) => thread.turns?.some((turn) => turn.id === run.turnId && turn.status === 'completed') ?? false);
    expect(transcript.featureId).toBeUndefined();
    expect(transcript.origin).toEqual({ featureId: 'automation', entityId: task.id });
    expect(transcript.projectId).toBe(scope === 'project' ? project.id : undefined);
    const listing = scope === 'project' ? `/v1/threads?scope=project&projectId=${project.id}` : '/v1/threads?scope=global';
    expect((await harness.runtimeFetch(listing)).threads).toMatchObject([{ id: run.threadId, origin: transcript.origin }]);
    expect(transcript.messages).toContainEqual(expect.objectContaining({ role: 'user', content: draft.prompt }));
    expect(transcript.messages).toContainEqual(expect.objectContaining({ role: 'assistant', status: 'complete' }));

    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const restored = await harness.runtimeFetch('/v1/features/automation/tasks') as AutomationSnapshot;
    expect((await harness.runtimeFetch(listing)).threads).toMatchObject([{ id: run.threadId, origin: transcript.origin }]);
    expect(restored.tasks[0].runs).toMatchObject([{ id: run.id, threadId: run.threadId, status: 'completed' }]);
    const saved = await harness.runtimeFetch(`/v1/features/automation/tasks/${task.id}`, {
      method: 'PUT', body: JSON.stringify({ draft: { ...draft, schedule: { kind: 'interval', minutes: 60 } } }),
    });
    expect(saved).toMatchObject({ status: 'active', nextRunAt: expect.any(String) });
    expect(await harness.runtimeFetch(`/v1/features/automation/tasks/${task.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'paused' }),
    })).toMatchObject({ status: 'paused', nextRunAt: null });
    expect(await harness.runtimeFetch(`/v1/features/automation/tasks/${task.id}`, { method: 'DELETE' })).toEqual({ deleted: true });
    expect((await harness.runtimeFetch('/v1/features/automation/tasks')).tasks).toEqual([]);
    expect((await harness.runtimeFetch(`/v1/threads/${run.threadId}`)).turns).toHaveLength(1);
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    expect((await harness.runtimeFetch(listing)).threads).toMatchObject([{ id: run.threadId, origin: transcript.origin }]);
  });
});

async function addProject(harness: RuntimeServerTestHarness): Promise<WorkspaceProject> {
  const directory = path.join(harness.runtimeDataDir, 'iriya');
  await mkdir(directory, { recursive: true });
  return harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: directory, name: 'iriya' }) });
}

async function appendMessage(store: SqliteThreadStore, thread: RuntimeThread, input: Pick<RuntimeMessage, 'id' | 'role' | 'content'> & Partial<RuntimeMessage>) {
  await store.appendEvent(thread.id, {
    id: `${thread.id}_${input.id}`, threadId: thread.id, type: 'message.created', createdAt: thread.createdAt,
    payload: { message: { createdAt: thread.createdAt, status: 'complete', ...input } },
  });
}
