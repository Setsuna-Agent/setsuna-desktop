import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
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

  it('exposes local project status and read-only file APIs', async () => {
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
      const search = await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/search?q=target`);
  
      expect(status).toMatchObject({ exists: true, readable: true });
      expect(entries.entries).toMatchObject([{ path: 'src/note.txt', type: 'file' }]);
      expect(entrySearch).toMatchObject({
        entries: [{ kind: 'file', name: 'note.txt', parent: 'src', path: 'src/note.txt' }],
        query: 'src/note',
        truncated: false,
      });
      expect(rootEntries.entries).toMatchObject([{ kind: 'directory', name: 'src', parent: '', path: 'src' }]);
      expect(file.content).toContain('local search target');
      expect(search.results).toMatchObject([{ path: 'src/note.txt', line: 1 }]);
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
