import {
  WORKSPACE_TEXT_FILE_MAX_BYTES,
  type RuntimeDataMigrationReadiness,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

describe('runtime server REST runtime state', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('freezes every REST mutation while a WebDAV snapshot is being staged', async () => {
    const project = await harness.runtimeFetch('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Before snapshot' }),
    });
    const stagingRoot = path.join(
      harness.runtimeDataDir,
      '.webdav-sync-work',
      'restore-fixture',
      'restored-data',
    );
    const stageBeforePreparation = await fetch(
      `${harness.baseUrl}/internal/webdav-sync/feature-settings/restore-stage`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documents: [], credentials: [], stagingRoot }),
      },
    );
    expect(stageBeforePreparation.status).toBe(409);
    await expect(stageBeforePreparation.json()).resolves.toMatchObject({
      code: 'webdav_sync_not_preparing',
    });
    const readiness = await waitForWebDavPreparation(harness);

    expect(readiness).toEqual({ ready: true, registeredTasks: 0, pendingMutations: 0 });
    await expect(harness.runtimeFetch('/internal/webdav-sync/feature-settings/restore-stage', {
      method: 'POST',
      body: JSON.stringify({ documents: [], credentials: [], stagingRoot }),
    })).resolves.toEqual({ targets: [] });
    const blocked = await fetch(`${harness.baseUrl}/v1/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${harness.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Must not be persisted' }),
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({ code: 'data_migration_preparing' });

    await harness.runtimeFetch('/internal/webdav-sync/prepare', { method: 'DELETE' });
    const updated = await harness.runtimeFetch(
      `/v1/projects/${encodeURIComponent(project.id)}`,
      { method: 'PATCH', body: JSON.stringify({ name: 'After snapshot' }) },
    );
    expect(updated).toMatchObject({ id: project.id, name: 'After snapshot' });
  });

  it('exposes local project status and revision-protected text-file APIs', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-server-project-'));
      await mkdir(path.join(projectDir, 'src'), { recursive: true });
      await writeFile(path.join(projectDir, 'src', 'note.txt'), 'server-side local search target\n');
  
      const project = await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir, name: 'Server fixture' }),
      });
      const status = await harness.runtimeFetch(`/v1/workspace/status?projectId=${encodeURIComponent(project.id)}`);
      const entries = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/files?path=src`);
      const entrySearch = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/entries/search?q=src%2Fnote`);
      const rootEntries = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/entries/search?q=&parent=`);
      const file = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/read?path=src%2Fnote.txt`);
      const savedFile = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/write?path=src%2Fnote.txt`, {
        method: 'PUT',
        body: JSON.stringify({
          content: 'saved from the file editor\n',
          expectedRevision: file.revision,
        }),
      });
      const search = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/search?q=saved`);
  
      expect(status).toMatchObject({ exists: true, readable: true });
      expect(entries.entries).toMatchObject([{ path: 'src/note.txt', type: 'file' }]);
      expect(entrySearch).toMatchObject({
        entries: [{ kind: 'file', name: 'note.txt', parent: 'src', path: 'src/note.txt' }],
        query: 'src/note',
        truncated: false,
      });
      expect(rootEntries.entries).toMatchObject([{ kind: 'directory', name: 'src', parent: '', path: 'src' }]);
      expect(file.content).toContain('local search target');
      expect(file.revision).toMatch(/^[a-f0-9]{64}$/u);
      expect(savedFile).toMatchObject({
        content: 'saved from the file editor\n',
        revision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(savedFile.revision).not.toBe(file.revision);
      expect(await readFile(path.join(projectDir, 'src', 'note.txt'), 'utf8')).toBe('saved from the file editor\n');
      expect(search.results).toMatchObject([{ path: 'src/note.txt', line: 1 }]);

      const largePath = path.join(projectDir, 'src', 'generated.html');
      const largeContent = `<style>src:url(data:font/woff2;base64,${'A'.repeat(WORKSPACE_TEXT_FILE_MAX_BYTES)})</style>`;
      await writeFile(largePath, largeContent);
      const largePreview = await harness.runtimeFetch(
        `/v1/projects/${encodeURIComponent(project.id)}/read?path=src%2Fgenerated.html`,
      );
      const largeEditable = await harness.runtimeFetch(
        `/v1/projects/${encodeURIComponent(project.id)}/read?path=src%2Fgenerated.html&mode=edit`,
      );
      const editedLargeContent = largeContent.replace('<style>', '<style>/* edited */');
      await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/write?path=src%2Fgenerated.html`, {
        method: 'PUT',
        body: JSON.stringify({
          content: editedLargeContent,
          expectedRevision: largeEditable.revision,
        }),
      });

      expect(largePreview).toMatchObject({ content: largeContent, truncated: false });
      expect(largeEditable).toMatchObject({ content: largeContent, truncated: false });
      expect(await readFile(largePath, 'utf8')).toBe(editedLargeContent);

      await writeFile(path.join(projectDir, 'src', 'note.txt'), 'external editor change\n');
      const conflictResponse = await fetch(
        `${harness.baseUrl}/v1/projects/${encodeURIComponent(project.id)}/write?path=src%2Fnote.txt`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${harness.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'stale local edit\n',
            expectedRevision: savedFile.revision,
          }),
        },
      );
      expect(conflictResponse.status).toBe(409);
      await expect(conflictResponse.json()).resolves.toMatchObject({ code: 'conflict' });
      expect(await readFile(path.join(projectDir, 'src', 'note.txt'), 'utf8')).toBe('external editor change\n');
    });
  
  it('returns an isolated temporary workspace for a global thread', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Temporary workspace thread' }),
      });
  
      const status = await harness.runtimeFetch(`/v1/workspace/status?threadId=${encodeURIComponent(thread.id)}`);
  
      expect(status).toMatchObject({
        exists: true,
        readable: true,
        project: {
          id: expect.stringMatching(new RegExp(`^temporary_workspace\\.\\d{4}-\\d{2}-\\d{2}\\.${thread.id}$`, 'u')),
          name: '临时目录',
          path: expect.stringContaining(path.join('temporary-workspace', '')),
        },
      });
      expect(status.project.path).toMatch(new RegExp(`${thread.id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'));
      expect((await stat(status.project.path)).isDirectory()).toBe(true);
    });
  
  it('exposes local usage summaries', async () => {
      const snapshot = await harness.runtimeFetch('/v1/features/usage/query', {
        method: 'POST',
        body: JSON.stringify({}),
      });
  
      expect(snapshot).toMatchObject({
        providers: [{
          id: 'local-test',
          name: 'Local test provider',
          provider: 'openai-compatible',
          models: [{ code: 'local-runtime-smoke', name: 'Local runtime smoke' }],
        }],
        usage: {
          records: [],
          summary: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            recordCount: 0,
            byDay: [],
            byProvider: [],
            byModel: [],
          },
        },
      });
      expect(snapshot.providers[0]).not.toHaveProperty('apiKey');
    });

  it('uses the provider id when a configured usage display name is blank', async () => {
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'blank-provider',
          providers: [{
            ...configuredProvider('blank-provider', 'blank-model'),
            name: '',
          }],
        }),
      });

      const snapshot = await harness.runtimeFetch('/v1/features/usage/query', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      expect(snapshot.providers).toMatchObject([{
        id: 'blank-provider',
        name: 'blank-provider',
      }]);
    });
  
  it('exposes local approval queue', async () => {
      const approvals = await harness.runtimeFetch('/v1/approvals');
  
      expect(approvals).toEqual({ approvals: [] });
    });

  it('exposes aggregate and conversation-scoped Runtime Activity projections', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Background services' }),
      });
      const encodedThreadId = encodeURIComponent(thread.id);
      const activities = await harness.runtimeFetch('/v1/features/runtime-activity');

      expect(activities).toMatchObject({
        backgroundServices: [],
        capturedAt: expect.any(String),
        tasks: [],
      });
      await expect(harness.runtimeFetch(
        `/v1/features/runtime-activity/services/${encodedThreadId}`,
      )).resolves.toEqual({ services: [] });
      await expect(harness.runtimeFetch(
        `/v1/features/runtime-activity/services/${encodedThreadId}/stale-process`,
        { method: 'DELETE' },
      )).resolves.toEqual({ terminated: false });
      await expect(harness.runtimeFetch(
        '/v1/features/runtime-activity/services/thread_deleted/stale-process',
        { method: 'DELETE' },
      )).resolves.toEqual({ terminated: false });
    });

  it('gates paged events and incremental traces behind conversation debug Feature settings', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Debug trace thread' }),
      });
      const debugPath = `/v1/features/conversation-debug/threads/${encodeURIComponent(thread.id)}/traces`;
      const eventPath = `/v1/features/conversation-debug/threads/${encodeURIComponent(thread.id)}/events`;
      const disabledResponse = await fetch(`${harness.baseUrl}${debugPath}/0`, {
        headers: { Authorization: `Bearer ${harness.token}` },
      });
      const disabledEventResponse = await fetch(`${harness.baseUrl}${eventPath}/0/${thread.lastSeq}/1`, {
        headers: { Authorization: `Bearer ${harness.token}` },
      });

      expect(disabledResponse.status).toBe(404);
      expect(disabledEventResponse.status).toBe(404);

      const settings = await harness.runtimeFetch('/v1/features/conversation-debug/settings');
      await harness.runtimeFetch('/v1/features/conversation-debug/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: settings.revision,
          patch: { enabled: true },
        }),
      });
      await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Produce a debug trace.' }),
      });
      const completedThread = await harness.waitForThread(
        thread.id,
        (current) => current.messages.some(
          (message) => message.role === 'assistant' && message.status === 'complete',
        ),
      );
      const firstPage = await harness.runtimeFetch(`${debugPath}/0`);
      expect(firstPage.traces).toContainEqual(expect.objectContaining({
        kind: 'model.history.normalized',
        threadId: thread.id,
        payload: expect.objectContaining({
          inputMessageCount: expect.any(Number),
          outputMessageCount: expect.any(Number),
        }),
      }));
      const lastSeq = firstPage.traces.at(-1)?.seq ?? 0;
      const nextPage = await harness.runtimeFetch(`${debugPath}/${lastSeq}`);
      expect(nextPage).toMatchObject({ traces: [], nextSeq: lastSeq + 1 });

      const firstEventPage = await harness.runtimeFetch(
        `${eventPath}/0/${completedThread.lastSeq}/2`,
      );
      const secondEventPage = await harness.runtimeFetch(
        `${eventPath}/2/${completedThread.lastSeq}/2`,
      );
      expect(firstEventPage).toMatchObject({
        throughSeq: completedThread.lastSeq,
        records: [{ seq: 1 }, { seq: 2 }],
      });
      expect(secondEventPage).toMatchObject({
        throughSeq: completedThread.lastSeq,
        records: [{ seq: 3 }, { seq: 4 }],
      });

      await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`, {
        method: 'DELETE',
      });
      const deletedThreadPage = await fetch(
        `${harness.baseUrl}${eventPath}/2/${completedThread.lastSeq}/2`,
        { headers: { Authorization: `Bearer ${harness.token}` } },
      );
      expect(deletedThreadPage.status).toBe(404);
      await expect(deletedThreadPage.json()).resolves.toMatchObject({
        code: 'THREAD_NOT_FOUND',
        retryable: false,
      });
    });
  
  it('starts turns with ids and accepts cancellation requests', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Cancelable' }),
      });
  
      const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'start a local smoke turn' }),
      });
      const cancelled = await harness.runtimeFetch(
        `/v1/threads/${encodeURIComponent(thread.id)}/turns/${encodeURIComponent(started.turnId)}/cancel`,
        { method: 'POST' },
      );
  
      expect(started).toMatchObject({ accepted: true });
      expect(typeof started.turnId).toBe('string');
      expect(cancelled).toMatchObject({ ok: true });
      expect(typeof cancelled.cancelled).toBe('boolean');
    });

  it('persists a changed model selection on an existing conversation', async () => {
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'provider-a',
          providers: [
            configuredProvider('provider-a', 'model-a'),
            configuredProvider('provider-b', 'model-b'),
          ],
        }),
      });
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Switchable model' }),
      });
      const threadPath = `/v1/threads/${encodeURIComponent(thread.id)}`;

      const selectedA = await harness.runtimeFetch(threadPath, {
        method: 'PATCH',
        body: JSON.stringify({
          modelSelection: { providerId: 'provider-a', modelId: 'model-a' },
        }),
      });
      expect(selectedA.modelBinding).toEqual({
        providerId: 'provider-a',
        modelId: 'model-a',
        modelCode: 'model-a-code',
      });

      const selectedB = await harness.runtimeFetch(threadPath, {
        method: 'PATCH',
        body: JSON.stringify({
          modelSelection: { providerId: 'provider-b', modelId: 'model-b' },
        }),
      });
      expect(selectedB.modelBinding).toEqual({
        providerId: 'provider-b',
        modelId: 'model-b',
        modelCode: 'model-b-code',
      });
      await expect(harness.runtimeFetch(threadPath)).resolves.toMatchObject({
        modelBinding: selectedB.modelBinding,
      });
    });

  it('returns invalid_model_selection for unavailable turn-like REST inputs', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Invalid model inputs' }),
      });
      const requests = [
        { path: 'turns', body: { input: 'Send now.' } },
        { path: 'queued-turn-inputs', body: { input: 'Send later.' } },
        {
          path: 'reviews',
          body: { target: { type: 'custom', instructions: 'Review this change.' } },
        },
      ];

      for (const item of requests) {
        const response = await fetch(
          `${harness.baseUrl}/v1/threads/${encodeURIComponent(thread.id)}/${item.path}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${harness.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...item.body,
              modelSelection: { providerId: 'missing-provider', modelId: 'missing-model' },
            }),
          },
        );

        expect(response.status, item.path).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          code: 'invalid_model_selection',
        });
      }
    });

  it('rejects removed Plan mode turn inputs', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Default mode only' }),
      });
      const turnPath = `/v1/threads/${encodeURIComponent(thread.id)}/turns`;

      await expect(harness.runtimeFetch(turnPath, {
        method: 'POST',
        body: JSON.stringify({ input: 'Plan first.', collaborationMode: 'plan' }),
      })).rejects.toThrow('Plan mode is no longer supported');
      await expect(harness.runtimeFetch(turnPath, {
        method: 'POST',
        body: JSON.stringify({ input: '', planDecision: 'accepted' }),
      })).rejects.toThrow('Plan decisions are no longer supported');
      await expect(harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/queued-turn-inputs`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Plan this later.', kind: 'plan' }),
      })).rejects.toThrow('Plan mode is no longer supported');

      const unchanged = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
      expect(unchanged.queuedTurnInputs ?? []).toEqual([]);
    });
  
  it('settles persisted active turns when the runtime starts', async () => {
      await harness.server.close();
      const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-stale-test-'));
      const threadId = await harness.seedStaleRuntimeThread(dataDir);
  
      await harness.startRuntimeServer(dataDir);
  
      const thread = (await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
      expect(thread.lastSeq).toBe(1);
      expect(thread.messages[0]).toMatchObject({
        status: 'complete',
        completedAt: expect.any(String),
        error: 'Turn cancelled because the desktop runtime restarted.',
      });
      expect(thread.messages[0].toolRuns?.[0]).toMatchObject({
        status: 'cancelled',
        resultPreview: 'Turn cancelled because the desktop runtime restarted.',
        completedAt: expect.any(String),
      });
    });
  
  it('settles persisted item-based active turns when the runtime starts', async () => {
      await harness.server.close();
      const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-stale-items-test-'));
      const threadId = await harness.seedStaleRuntimeItemThread(dataDir);
  
      await harness.startRuntimeServer(dataDir);
  
      const thread = (await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
      expect(thread.lastSeq).toBe(1);
      expect(thread.activeTurnId).toBeNull();
      expect(thread.turns?.[0]).toMatchObject({
        id: 'turn_stale_items',
        status: 'cancelled',
        completedAt: expect.any(String),
        error: 'Turn cancelled because the desktop runtime restarted.',
        items: [
          { id: 'agent_item_stale', status: 'cancelled' },
          { id: 'tool_item_stale', status: 'cancelled' },
        ],
      });
    });
});

function configuredProvider(id: string, modelId: string) {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    baseUrl: `https://${id}.example.test`,
    apiKey: `sk-${id}`,
    enabled: true,
    models: [{
      id: modelId,
      name: modelId,
      code: `${modelId}-code`,
      enabled: true,
      maxOutputTokens: 1_000,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}

async function waitForWebDavPreparation(
  harness: RuntimeServerTestHarness,
): Promise<RuntimeDataMigrationReadiness> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readiness = await harness.runtimeFetch('/internal/webdav-sync/prepare', {
      method: 'POST',
    }) as RuntimeDataMigrationReadiness;
    if (readiness.ready) return readiness;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Runtime did not become ready for a WebDAV snapshot.');
}
