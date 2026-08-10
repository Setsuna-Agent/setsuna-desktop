import {
  RUNTIME_DEVELOPER_FEATURES_FLAG,
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
    const readiness = await waitForWebDavPreparation(harness);

    expect(readiness).toEqual({ ready: true, registeredTasks: 0, pendingMutations: 0 });
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
      const usage = await harness.runtimeFetch('/v1/usage');
  
      expect(usage).toMatchObject({
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
      });
    });
  
  it('exposes local approval queue', async () => {
      const approvals = await harness.runtimeFetch('/v1/approvals');
  
      expect(approvals).toEqual({ approvals: [] });
    });

  it('exposes the aggregate runtime activity projection', async () => {
      const activities = await harness.runtimeFetch('/v1/runtime-activities');

      expect(activities).toMatchObject({
        backgroundServices: [],
        capturedAt: expect.any(String),
        tasks: [],
      });
    });

  it('gates incremental in-memory debug traces behind developer features', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Debug trace thread' }),
      });
      const debugPath = `/v1/threads/${encodeURIComponent(thread.id)}/debug-traces`;
      const disabledResponse = await fetch(`${harness.baseUrl}${debugPath}`, {
        headers: { Authorization: `Bearer ${harness.token}` },
      });

      expect(disabledResponse.status).toBe(404);

      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          features: { [RUNTIME_DEVELOPER_FEATURES_FLAG]: true },
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
      expect(completedThread.turns?.flatMap((turn) => (
        turn.stepSnapshots?.flatMap((step) => step.snapshot.featureKeys) ?? []
      ))).not.toContain(RUNTIME_DEVELOPER_FEATURES_FLAG);

      const firstPage = await harness.runtimeFetch(debugPath);
      expect(firstPage.traces).toContainEqual(expect.objectContaining({
        kind: 'model.history.normalized',
        threadId: thread.id,
        payload: expect.objectContaining({
          inputMessageCount: expect.any(Number),
          outputMessageCount: expect.any(Number),
        }),
      }));
      const lastSeq = firstPage.traces.at(-1)?.seq ?? 0;
      const nextPage = await harness.runtimeFetch(`${debugPath}?afterSeq=${lastSeq}`);
      expect(nextPage).toMatchObject({ traces: [], nextSeq: lastSeq + 1 });
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
