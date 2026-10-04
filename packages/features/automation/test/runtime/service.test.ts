import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDraft, AutomationRun, AutomationRuntimeHost } from '../../src/contracts/index.js';
import { AutomationService } from '../../src/runtime/service.js';
import { AutomationTools } from '../../src/runtime/tools.js';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'setsuna-automation-'));
  directories.push(dataDir);
  let now = new Date('2026-09-30T00:00:00Z');
  let sequence = 0;
  let outcome: AutomationRun['status'] = 'running';
  const host: AutomationRuntimeHost = {
    dataDir, now: () => now, id: (prefix) => `${prefix}_${++sequence}`,
    reconcileConversationOwnership: vi.fn(async () => undefined),
    canReuseConversation: vi.fn(async () => true),
    createConversation: vi.fn(async () => 'conversation_1'),
    createExecutionThread: vi.fn(async () => `execution_${++sequence}`),
    threadExists: vi.fn(async () => true),
    resolveProject: vi.fn(async (_threadId, projectId) => projectId ?? null),
    listProjects: async () => [{ id: 'iriya', name: 'iriya', path: '/projects/iriya' }],
    listModels: async () => [{ providerId: 'provider', modelId: 'model', name: 'Test model', thinkingEfforts: ['high'] }],
    defaultModel: async () => ({ providerId: 'provider', modelId: 'model' }),
    startRun: vi.fn(async () => `turn_${++sequence}`), runStatus: async () => ({ status: outcome }),
  };
  const service = new AutomationService(host);
  await service.initialize();
  const draft: AutomationDraft = { title: '整理文件', prompt: '整理下载目录并记录结果', schedule: { kind: 'interval', minutes: 10 }, newChat: false };
  return { service, host, draft, advance: (at: string) => { now = new Date(at); }, finish: () => { outcome = 'completed'; } };
}

describe('local scheduled conversations', () => {
  it('keeps sampling instructions stable while list returns fresh scheduling context', async () => {
    const f = await fixture();
    const snapshot = vi.spyOn(f.service, 'snapshot');
    const now = vi.fn(f.host.now);
    const tools = new AutomationTools(f.service, now);
    const prompt = tools.systemPrompt();
    expect(snapshot).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();

    const initial = JSON.parse((await tools.runTool({ mode: 'list' }, 'conversation_1')).content);
    expect(initial.tasks).toEqual([]);
    expect(new Date(initial.currentLocalTime).toISOString()).toBe('2026-09-30T00:00:00.000Z');

    const task = await f.service.create('conversation_1', f.draft);
    const otherTask = await f.service.create('conversation_2', f.draft);
    await f.service.setStatus(task.id, 'paused');
    const models = [{ providerId: 'provider', modelId: 'new_model', name: 'New model', thinkingEfforts: ['low'] }];
    const projects = [{ id: 'new_project', name: 'New project', path: '/projects/new' }];
    vi.spyOn(f.host, 'listModels').mockResolvedValue(models);
    vi.spyOn(f.host, 'listProjects').mockResolvedValue(projects);
    f.advance('2026-09-30T01:02:03Z');
    snapshot.mockClear();
    now.mockClear();

    expect(tools.systemPrompt()).toBe(prompt);
    expect(snapshot).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    const latest = JSON.parse((await tools.runTool({ mode: 'list' }, 'conversation_1')).content);
    expect(new Date(latest.currentLocalTime).toISOString()).toBe('2026-09-30T01:02:03.000Z');
    expect(latest).toMatchObject({
      conversationThreadId: 'conversation_1', models, projects,
      tasks: [
        { id: task.id, conversationThreadId: 'conversation_1', status: 'paused' },
        { id: otherTask.id, conversationThreadId: 'conversation_2', status: 'active' },
      ],
    });
  });

  it('counts running and queued mutations until every durable operation settles, including rejection', async () => {
    const f = await fixture();
    const task = await f.service.create('conversation_1', f.draft);
    let finishStart: (turnId: string) => void = () => undefined;
    vi.mocked(f.host.startRun).mockImplementation(() => new Promise((resolve) => { finishStart = resolve; }));
    const running = f.service.run(task.id);
    const invalid = f.service.update('missing-task', f.draft);
    const rejected = expect(invalid).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    const queued = f.service.createConversation();
    await vi.waitFor(() => expect(f.host.startRun).toHaveBeenCalledOnce());
    expect(f.service.pendingMutationCount()).toBe(3);
    finishStart('turn');
    await Promise.all([running, rejected, queued]);
    expect(f.service.pendingMutationCount()).toBe(0);
  });

  it('creates and dispatches a calendar task from the agent tool using the machine clock', async () => {
    const options = Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...options, timeZone: 'Asia/Shanghai' });
    const f = await fixture();
    const tools = new AutomationTools(f.service, f.host.now);
    await tools.runTool({ mode: 'create', title: f.draft.title, prompt: f.draft.prompt, schedule: { kind: 'daily', time: '09:00' } }, 'conversation_1');
    expect((await f.service.snapshot()).tasks[0]).toMatchObject({ nextRunAt: '2026-09-30T01:00:00.000Z' });
    f.advance('2026-09-30T00:59:00Z'); await f.service.tick();
    expect(f.host.startRun).not.toHaveBeenCalled();
    f.advance('2026-09-30T01:00:00Z'); await f.service.tick();
    expect(f.host.startRun).toHaveBeenCalledOnce();
    expect((await f.service.snapshot()).tasks[0]).toMatchObject({ nextRunAt: '2026-10-01T01:00:00.000Z' });
  });

  it('reuses a pristine draft across concurrent new-task requests, but creates a draft after input or task save', async () => {
    const f = await fixture();
    vi.mocked(f.host.createConversation).mockImplementation(async () => f.host.id('conversation'));
    const requests = await Promise.all([f.service.createConversation(), f.service.createConversation(), f.service.createConversation()]);
    expect(new Set(requests.map((item) => item.threadId)).size).toBe(1);
    expect(f.host.createConversation).toHaveBeenCalledOnce();
    vi.mocked(f.host.canReuseConversation).mockResolvedValueOnce(false);
    const started = await f.service.createConversation();
    expect(started.threadId).not.toBe(requests[0].threadId);
    await f.service.create(started.threadId, f.draft);
    expect((await f.service.snapshot()).draftThreadId).toBeUndefined();
    const fresh = await f.service.createConversation();
    expect(fresh.threadId).not.toBe(started.threadId);
    expect(f.host.createConversation).toHaveBeenCalledTimes(3);
  });

  it('creates from an agent tool, persists it, and reserves one due run across concurrent ticks', async () => {
    const f = await fixture();
    const tools = new AutomationTools(f.service, f.host.now);
    const result = await tools.runTool({ mode: 'create', title: f.draft.title, prompt: f.draft.prompt, schedule: f.draft.schedule, project_id: 'iriya' }, 'conversation_1');
    expect(result.data).toMatchObject({ resultKind: 'automation.task', payload: { status: 'active', modelSelection: { modelId: 'model' } } });
    const task = (await f.service.snapshot()).tasks[0];
    f.advance('2026-09-30T00:10:00Z');
    await Promise.all([f.service.tick(), f.service.tick(), f.service.tick()]);
    expect(f.host.startRun).toHaveBeenCalledTimes(1);
    expect(f.host.createExecutionThread).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, projectId: 'iriya' }));
    expect(f.host.startRun).toHaveBeenCalledWith(expect.stringMatching(/^execution_/u), expect.objectContaining({ input: f.draft.prompt, modelSelection: { providerId: 'provider', modelId: 'model' } }));
    const stored = JSON.parse(await readFile(path.join(f.host.dataDir, 'features', 'automation', 'tasks.json'), 'utf8'));
    expect(stored.tasks[0]).toMatchObject({ id: task.id, projectId: 'iriya', nextRunAt: '2026-09-30T00:20:00.000Z', runs: [{ status: 'running', turnId: expect.any(String) }] });
  });

  it('inherits the source project, preserves it on edits, and starts a fresh chat when moved to global conversations', async () => {
    const f = await fixture();
    vi.mocked(f.host.resolveProject).mockImplementation(async (_threadId, projectId) => projectId === undefined ? 'iriya' : projectId);
    const task = await f.service.create('conversation_1', f.draft);
    const first = await f.service.run(task.id);
    await expect(f.service.update(task.id, { ...f.draft, projectId: null })).rejects.toMatchObject({ code: 'TASK_BUSY' });
    f.finish(); await f.service.tick();
    expect(await f.service.update(task.id, { ...f.draft, title: 'Edited' })).toMatchObject({ projectId: 'iriya', executionThreadId: first.executionThreadId });
    const moved = await f.service.update(task.id, { ...f.draft, projectId: null });
    expect(moved.executionThreadId).toBeUndefined();
    const second = await f.service.run(task.id);
    expect(second.runs.map((run) => run.threadId)).toEqual([first.executionThreadId, second.executionThreadId]);
    expect(second.executionThreadId).not.toBe(first.executionThreadId);
    expect(f.host.createExecutionThread).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null }));
  });

  it('rejects invalid projects and records removed projects as failed runs without falling back to another workspace', async () => {
    const f = await fixture();
    const task = await f.service.create('conversation_1', { ...f.draft, projectId: 'iriya' });
    vi.mocked(f.host.resolveProject).mockRejectedValue(new Error('Project unavailable'));
    await expect(f.service.update(task.id, { ...f.draft, projectId: 'missing' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const dispatched = await f.service.run(task.id);
    expect(dispatched).toMatchObject({ projectId: 'iriya', runs: [{ status: 'failed', error: 'Project unavailable' }] });
    expect(f.host.createExecutionThread).not.toHaveBeenCalled();
    expect(f.host.startRun).not.toHaveBeenCalled();
  });

  it('skips overlapping occurrences, reuses a conversation, and can create fresh chats', async () => {
    const f = await fixture();
    const task = await f.service.create('conversation_1', f.draft);
    f.advance('2026-09-30T00:10:00Z'); await f.service.tick();
    f.advance('2026-09-30T00:20:00Z'); await f.service.tick();
    expect(f.host.startRun).toHaveBeenCalledTimes(1);
    f.finish(); f.advance('2026-09-30T00:30:00Z'); await f.service.tick();
    expect(f.host.createExecutionThread).toHaveBeenCalledTimes(1);
    const updated = await f.service.update(task.id, { ...f.draft, newChat: true });
    expect(updated.nextRunAt).toBe('2026-09-30T00:40:00.000Z');
    f.advance('2026-09-30T00:40:00Z'); await f.service.tick();
    expect(f.host.createExecutionThread).toHaveBeenCalledTimes(2);
  });

  it('pauses scheduling without removing history and supports manual runs while paused', async () => {
    const f = await fixture(); const task = await f.service.create('conversation_1', f.draft);
    await f.service.setStatus(task.id, 'paused');
    f.advance('2026-09-30T12:00:00Z'); await f.service.tick();
    expect(f.host.startRun).not.toHaveBeenCalled();
    await f.service.run(task.id);
    expect((await f.service.snapshot()).tasks[0]).toMatchObject({ status: 'paused', nextRunAt: null, runs: [{ status: 'running' }] });
    await expect(f.service.run(task.id)).rejects.toMatchObject({ code: 'TASK_BUSY' });
    await expect(f.service.delete(task.id)).rejects.toMatchObject({ code: 'TASK_BUSY' });
  });

  it('does not replay reserved runs after restart and collapses missed intervals', async () => {
    const f = await fixture(); await f.service.create('conversation_1', f.draft);
    f.advance('2026-09-30T00:10:00Z'); await f.service.tick(); await f.service.dispose();
    const recovered = new AutomationService(f.host); await recovered.initialize(); await recovered.tick();
    expect((await recovered.snapshot()).tasks[0].runs[0].status).toBe('interrupted');
    expect(f.host.startRun).toHaveBeenCalledTimes(1);
    f.advance('2026-09-30T02:07:00Z'); await recovered.tick(); await recovered.tick();
    expect(f.host.startRun).toHaveBeenCalledTimes(2);
    expect((await recovered.snapshot()).tasks[0].nextRunAt).toBe('2026-09-30T02:10:00.000Z');
  });

  it('completes one-shot schedules and records execution failure without retrying', async () => {
    const f = await fixture();
    vi.mocked(f.host.startRun).mockRejectedValueOnce(new Error('Model unavailable'));
    await f.service.create('conversation_1', { ...f.draft, schedule: { kind: 'once', at: '2026-09-30T01:00:00Z' } });
    f.advance('2026-09-30T01:00:00Z'); await f.service.tick(); await f.service.tick();
    expect((await f.service.snapshot()).tasks[0]).toMatchObject({ status: 'completed', nextRunAt: null, runs: [{ status: 'failed', error: 'Model unavailable' }] });
    expect(f.host.startRun).toHaveBeenCalledTimes(1);
  });

  it('recovers completed transcripts when the app exits before the scheduler settles their records', async () => {
    const f = await fixture(); await f.service.create('conversation_1', f.draft);
    await f.service.run((await f.service.snapshot()).tasks[0].id);
    f.finish(); await f.service.dispose();
    const recovered = new AutomationService(f.host); await recovered.initialize();
    expect((await recovered.snapshot()).tasks[0].runs[0]).toMatchObject({ status: 'completed', finishedAt: expect.any(String) });
    expect(f.host.startRun).toHaveBeenCalledTimes(1);
  });

  it('records thread creation failures and still dispatches other due tasks', async () => {
    const f = await fixture();
    await f.service.create('conversation_1', f.draft);
    await f.service.create('conversation_1', { ...f.draft, title: '第二个任务' });
    vi.mocked(f.host.createExecutionThread).mockRejectedValueOnce(new Error('Workspace unavailable'));
    f.advance('2026-09-30T00:10:00Z'); await f.service.tick(); await f.service.tick();
    expect(f.host.startRun).toHaveBeenCalledTimes(1);
    const tasks = (await f.service.snapshot()).tasks;
    expect(tasks[0]).toMatchObject({ nextRunAt: '2026-09-30T00:20:00.000Z', runs: [{ status: 'failed', error: 'Workspace unavailable' }] });
    expect(tasks[1].runs[0].status).toBe('running');
  });

  it('rejects unsupported models and past one-shot times without changing the schedule', async () => {
    const f = await fixture(); const task = await f.service.create('conversation_1', f.draft);
    await expect(f.service.update(task.id, { ...f.draft, thinkingEffort: 'unsupported' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(f.service.update(task.id, { ...f.draft, schedule: { kind: 'once', at: '2026-09-29T00:00:00Z' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await f.service.snapshot()).tasks[0].nextRunAt).toBe(task.nextRunAt);
  });
});
