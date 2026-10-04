import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';
import { RuntimeApiToolHost } from '../../../src/adapters/tool/runtime-api-tool-host.js';
import { createRuntimeApiClient } from '../../../src/server/runtime-api-client.js';
import { readValidatedFileText } from '../../../src/adapters/tool/pc-local/pc-local-tool-secure-read.js';
import { installedAppBuilder } from '../../support/app-builder.js';

it('prevents the authoring tool from reading a denied file through the desktop project API', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const workspace = path.join(harness.runtimeDataDir, 'workspace');
    const deniedRoot = path.join(workspace, 'private');
    await mkdir(deniedRoot, { recursive: true });
    await writeFile(path.join(deniedRoot, 'secret.txt'), 'denied-file-test-content');
    const project = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: workspace }) });
    const target = `/v1/projects/${project.id}/read?path=private/secret.txt`;
    const api = createRuntimeApiClient({ baseUrl: () => harness.baseUrl, token: harness.token });
    expect(JSON.stringify(await api.request({ path: target }))).toContain('denied-file-test-content');
    const sandboxWorkspaceWrite = { deniedRoots: [deniedRoot] };
    await expect(readValidatedFileText('private/secret.txt', {
      root: workspace, permissionProfile: 'workspace-write', sandboxWorkspaceWrite,
    })).rejects.toThrow('deny');

    const host = new RuntimeApiToolHost(api, { listPlugins: async () => ({ plugins: [installedAppBuilder()] }) });
    const context = {
      threadId: 'authoring', permissionProfile: 'workspace-write' as const, sandboxWorkspaceWrite,
      environment: { id: 'workspace', cwd: workspace, workspaceRoot: workspace, workspaceRoots: [workspace] },
    };
    await expect(host.runTool('read_runtime_api', { path: target }, context)).rejects.toThrow('Use file tools');
    const projects = await host.runTool('read_runtime_api', { path: '/v1/projects' }, context);
    expect(projects.data).toMatchObject({ data: { projects: [expect.objectContaining({ id: project.id })] } });
  } finally {
    await harness.close();
  }
});

it('exposes durable message and tool history, including full output pages associated with their conversation', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    await harness.server.close();
    const dataDir = path.join(harness.runtimeDataDir, 'runtime');
    const store = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    let threadId: string;
    let otherThreadId: string;
    try {
      const thread = await store.createThread({ title: 'Persisted conversation' });
      threadId = thread.id;
      otherThreadId = (await store.createThread({ title: 'Another conversation' })).id;
      const createdAt = new Date().toISOString();
      const common = { threadId, createdAt, turnId: 'turn_history' };
      await store.appendEvents(threadId, [{
        ...common, id: 'event_message', type: 'message.created', payload: {
          message: { id: 'message_history', role: 'assistant', content: 'Conversation summary', status: 'complete', createdAt, turnId: common.turnId },
        },
      }, {
        ...common, id: 'event_started', type: 'tool.started', payload: {
          toolCallId: 'call_history', toolName: 'read_file', argumentsPreview: '{"path":"notes.md"}',
        },
      }, {
        ...common, id: 'event_completed', type: 'tool.completed', payload: {
          toolCallId: 'call_history', toolName: 'read_file', status: 'success', content: 'Output preview',
          data: { result_id: 'result_history' },
        },
      }]);
      await new FileToolResultStore(dataDir).save({
        resultId: 'result_history', threadId, toolCallId: 'call_history', toolName: 'read_file',
        fullText: '完整输出：项目汇总', originalEstimatedTokens: 100, visibleTokenLimit: 10, locallyTruncated: false,
      });
    } finally {
      await store.close();
    }
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const messages = await harness.runtimeFetch(`/v1/threads/${threadId}/messages?limit=10`);
    expect(messages.messages).toEqual([expect.objectContaining({
      content: 'Conversation summary', toolRuns: [expect.objectContaining({ name: 'read_file', status: 'success' })],
    })]);
    const history = await harness.runtimeFetch(`/v1/threads/${threadId}/event-history`);
    expect(history.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool.started', payload: expect.objectContaining({ argumentsPreview: '{"path":"notes.md"}' }) }),
      expect.objectContaining({ type: 'tool.completed', payload: expect.objectContaining({ content: 'Output preview' }) }),
    ]));
    const outputPath = `/v1/threads/${threadId}/tool-results/result_history`;
    const first = await harness.runtimeFetch(`${outputPath}?limit=6`);
    const rest = await harness.runtimeFetch(`${outputPath}?offset=${first.nextOffset}`);
    expect(first.content + rest.content).toBe('完整输出：项目汇总');
    expect(rest.nextOffset).toBeNull();
    await expect(harness.runtimeFetch(`/v1/threads/${otherThreadId}/tool-results/result_history`)).rejects.toThrow(/not found/u);
  } finally {
    await harness.close();
  }
});

it('lets a trusted projectless application read and mutate real backend data, and revokes access with trust', async () => {
  const harness = await createRuntimeServerTestHarness();
  const deleteThread = vi.spyOn(InMemoryDesktopNativeBridge.prototype, 'deleteThread');
  try {
    const source = path.join(harness.runtimeDataDir, 'app-source');
    await mkdir(path.join(source, '.setsuna-plugin'), { recursive: true });
    await writeFile(path.join(source, 'entry.mjs'), `export default function (api) {
      api.onUiAction('load', async (_input, ctx) => {
        const response = await ctx.runtime.request({path:'/v1/projects'});
        await ctx.state.set('view', response.data);
      });
    }`);
    await writeFile(path.join(source, 'app.html'), '<main>App</main>');
    await writeFile(path.join(source, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
      schemaVersion: 2, id: 'runtime-app', name: 'Runtime App', version: '1.0.0',
      resources: [{ id: 'app-html', path: 'app.html' }],
      extension: {
        apiVersion: 1, runtime: 'node-worker', entry: 'entry.mjs', capabilities: ['ui', 'state'],
        rendererUi: {
          schemaVersion: 2, actions: [{ id: 'load', approval: { message: 'Load projects' } }],
          contributions: [{
            id: 'app.page', slot: 'renderer.plugin.page', navigation: { label: 'App' },
            data: { scope: 'global', stateKey: 'view' },
            document: { htmlResourceId: 'app-html', actionIds: ['load'] },
          }],
        },
      },
    }));
    await harness.runtimeFetch('/v1/features/plugin-management/install-local', { method: 'POST', body: JSON.stringify({ path: source }) });
    const base = '/v1/features/plugin-management/installed/runtime-app';
    const call = (request: { path: string; method?: string; body?: unknown }, contributionId = 'app.page') => (
      harness.runtimeFetch(`${base}/renderer-ui/runtime-request`, {
        method: 'POST', body: JSON.stringify({ contributionId, request }),
      })
    );
    await expect(call({ path: '/v1/projects' })).rejects.toThrow(/trusted/u);
    await harness.runtimeFetch(`${base}/extension-trust`, { method: 'PUT', body: JSON.stringify({ trusted: true }) });
    await expect(call({
      path: '/v1/features/plugin-management/install-local?from=sidebar', method: 'POST', body: { path: source },
    })).rejects.toThrow('directory picker');

    const project = await call({ path: '/v1/projects', method: 'POST', body: { name: 'Existing project' } });
    expect(project.ok).toBe(true);
    const projects = await call({ path: '/v1/projects' });
    expect(projects.data.projects).toEqual([expect.objectContaining({ id: project.data.id, name: 'Existing project' })]);
    const first = await call({ path: '/v1/threads', method: 'POST', body: { title: 'Project conversation', projectId: project.data.id } });
    const second = await call({ path: '/v1/threads', method: 'POST', body: { title: 'Global conversation' } });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    await call({ path: `/v1/threads/${first.data.id}`, method: 'PATCH', body: { title: 'Renamed', archived: true } });
    const conversations = await call({ path: '/v1/threads?scope=all&includeArchived=true' });
    expect(conversations.data.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.data.id, title: 'Renamed', archived: true }),
      expect.objectContaining({ id: second.data.id, title: 'Global conversation' }),
    ]));
    const messages = await call({ path: `/v1/threads/${first.data.id}/messages?limit=10` });
    expect(messages.data).toMatchObject({ messages: [], nextBefore: null });
    const events = await call({ path: `/v1/threads/${first.data.id}/event-history?limit=1` });
    expect(events.data).toMatchObject({ events: [expect.objectContaining({ type: 'thread.created' })], hasMore: true });
    const next = await call({ path: `/v1/threads/${first.data.id}/event-history?sinceSeq=${events.data.nextSinceSeq}` });
    expect(next.data.events.length).toBeGreaterThan(0);
    expect(next.data.events.every((event: { seq: number }) => event.seq > events.data.nextSinceSeq)).toBe(true);
    expect(next.data.hasMore).toBe(false);
    const catalog = await call({ path: '/v1/runtime-api' });
    expect(catalog.data.featureOperations).toContainEqual(expect.objectContaining({ id: 'plugin-management.snapshot.read' }));
    expect(catalog.data.featureOperations).not.toContainEqual(expect.objectContaining({ path: '/v1/features/plugin-management/install-local' }));

    // Worker handlers and document requests use the same live transport.
    await harness.runtimeFetch(`${base}/renderer-ui/actions/load`, {
      method: 'POST', body: JSON.stringify({ values: {}, context: { contributionId: 'app.page', surface: 'renderer.plugin.page' } }),
    });
    const state = await harness.runtimeFetch(`${base}/renderer-ui/data`, {
      method: 'POST', body: JSON.stringify({ context: { contributionId: 'app.page', surface: 'renderer.plugin.page' } }),
    });
    expect(state.data.projects).toEqual(projects.data.projects);
    expect(JSON.stringify(state)).not.toContain(harness.token);
    await expect(call({ path: '/v1/projects' }, 'forged.page')).rejects.toThrow(/sidebar application/u);
    const missing = await call({ path: '/v1/threads/missing' });
    expect(missing).toMatchObject({ status: 404, ok: false });
    const remove = { path: `/v1/threads/${second.data.id}`, method: 'DELETE' };
    await expect(call(remove)).rejects.toThrow('Desktop host');
    expect(await call({ path: remove.path })).toMatchObject({ ok: true });
    await expect(call({ path: '/v1/swe/app-server', method: 'POST', body: {
      id: 1, method: 'thread/delete', params: { threadId: second.data.id },
    } })).rejects.toThrow('coordinated');
    deleteThread.mockResolvedValueOnce({ cancelled: true });
    expect(await call(remove)).toMatchObject({ ok: false, status: 409, data: { cancelled: true } });
    expect(await call({ path: remove.path })).toMatchObject({ ok: true });
    // Only the host-approved path may reach the authenticated backend deletion route.
    deleteThread.mockImplementationOnce((threadId) => harness.runtimeFetch(`/v1/threads/${threadId}`, { method: 'DELETE' }));
    expect(await call(remove)).toMatchObject({ ok: true, status: 200 });
    expect(deleteThread).toHaveBeenLastCalledWith(second.data.id, expect.any(AbortSignal));
    expect(await call({ path: `/v1/threads/${second.data.id}` })).toMatchObject({ status: 404 });

    await harness.runtimeFetch(`${base}/extension-trust`, { method: 'PUT', body: JSON.stringify({ trusted: false }) });
    await expect(call({ path: '/v1/projects' })).rejects.toThrow(/trusted/u);
  } finally {
    deleteThread.mockRestore();
    await harness.close();
  }
});
