import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createOpenAiCaptureServer,
  withTimeout
} from '../../support/runtime-server/shared.js';

describe('runtime server REST threads and attachments', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('returns 400 for malformed request JSON', async () => {
      const response = await fetch(`${harness.baseUrl}/v1/threads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: '{broken',
      });
  
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_json' });
    });
  
  it('uploads and deletes validated pending document attachments', async () => {
      const query = new URLSearchParams({ name: 'guide.pdf', type: 'application/pdf' });
      const upload = await fetch(`${harness.baseUrl}/v1/attachments?${query}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from('%PDF-1.7\nruntime attachment'),
      });
  
      expect(upload.status).toBe(201);
      const attachment = await upload.json() as { assetId: string; name: string; source: string; type: string };
      expect(attachment).toMatchObject({
        assetId: expect.stringMatching(/^attachment_/u),
        name: 'guide.pdf',
        source: 'runtime',
        type: 'application/pdf',
      });
  
      const deleted = await harness.runtimeFetch(`/v1/attachments/${encodeURIComponent(attachment.assetId)}`, { method: 'DELETE' });
      expect(deleted).toEqual({ deleted: true });
  
      const invalid = await fetch(`${harness.baseUrl}/v1/attachments?${query}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from('not a PDF'),
      });
      expect(invalid.status).toBe(415);
      await expect(invalid.json()).resolves.toMatchObject({ code: 'attachment_unsupported' });
    });
  
  it('claims stored documents for a turn and exposes only a read-only path to the model', async () => {
      const capture = await createOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('attachment-provider', capture.baseUrl);
        const query = new URLSearchParams({ name: 'guide.pdf', type: 'application/pdf' });
        const upload = await fetch(`${harness.baseUrl}/v1/attachments?${query}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/octet-stream' },
          body: Buffer.from('%PDF-1.7\nplugin-readable attachment'),
        });
        const attachment = await upload.json();
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Attachment context' }),
        });
  
        const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ input: 'Summarize the attached document.', attachments: [attachment] }),
        });
        const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for attachment model request');
        const serializedMessages = JSON.stringify(request.messages ?? []);
        const updated = await harness.waitForThread(
          thread.id,
          (item) => item.messages.some((message) => message.turnId === started.turnId && message.role === 'user'),
        );
  
        expect(serializedMessages).toContain('Runtime-managed user attachments for this thread');
        expect(serializedMessages).toContain('guide.pdf');
        expect(serializedMessages).toContain('read-only');
        expect(serializedMessages).not.toContain('plugin-readable attachment');
        expect(updated.messages.find((message) => message.turnId === started.turnId && message.role === 'user'))
          .toMatchObject({ attachments: [expect.objectContaining({ source: 'runtime', name: 'guide.pdf' })] });
      } finally {
        await capture.close();
      }
    });
  
  it('creates and lists local and project threads', async () => {
      const created = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Smoke' }),
      });
      const projectThread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Project smoke', projectId: 'project_1' }),
      });
  
      expect(created.title).toBe('Smoke');
      expect(projectThread).toMatchObject({ title: 'Project smoke', projectId: 'project_1' });
  
      const list = await harness.runtimeFetch('/v1/threads');
      const globalList = await harness.runtimeFetch('/v1/threads?scope=global');
      const projectList = await harness.runtimeFetch('/v1/threads?projectId=project_1');
  
      expect(list.threads.map((thread: { id: string }) => thread.id).sort()).toEqual([created.id, projectThread.id].sort());
      expect(globalList.threads).toMatchObject([{ id: created.id }]);
      expect(projectList.threads).toMatchObject([{ id: projectThread.id }]);
    });
  
  it('lists and idempotently terminates background shell services for a conversation', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Background services' }),
      });
      const encodedThreadId = encodeURIComponent(thread.id);
  
      await expect(harness.runtimeFetch(`/v1/threads/${encodedThreadId}/background-shell-processes`))
        .resolves.toEqual({ processes: [] });
      await expect(harness.runtimeFetch(`/v1/threads/${encodedThreadId}/background-shell-processes/stale-process`, {
        method: 'DELETE',
      })).resolves.toEqual({ terminated: false });
    });
  
  it('renames and archives local threads through the runtime API', async () => {
      const created = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Draft title' }),
      });
  
      const renamed = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(created.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Renamed title' }),
      });
      const archived = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(created.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      const defaultList = await harness.runtimeFetch('/v1/threads');
      const archivedList = await harness.runtimeFetch('/v1/threads?includeArchived=true');
  
      expect(renamed).toMatchObject({ id: created.id, title: 'Renamed title' });
      expect(archived).toMatchObject({ id: created.id, archived: true });
      expect(defaultList.threads).toEqual([]);
      expect(archivedList.threads).toMatchObject([{ id: created.id, title: 'Renamed title', archived: true }]);
    });
  
  it('archives a project together with all of its conversations', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-archived-project-test-'));
      const project = await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir }),
      });
      const firstThread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'First project thread', projectId: project.id }),
      });
      const secondThread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Second project thread', projectId: project.id }),
      });
  
      await harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST' });
  
      const projects = await harness.runtimeFetch('/v1/projects');
      const activeThreads = await harness.runtimeFetch(`/v1/threads?projectId=${encodeURIComponent(project.id)}`);
      const allThreads = await harness.runtimeFetch(`/v1/threads?projectId=${encodeURIComponent(project.id)}&includeArchived=true`);
      expect(projects.projects).toEqual([]);
      expect(activeThreads.threads).toEqual([]);
      expect(allThreads.threads).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: secondThread.id, archived: true }),
        expect.objectContaining({ id: firstThread.id, archived: true }),
      ]));
  
      const restored = await harness.runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir }),
      });
      expect(restored.id).toBe(project.id);
    });
  
  it('rejects encoded path separators in thread ids', async () => {
      const response = await fetch(`${harness.baseUrl}/v1/threads/..%2Fescaped`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'must not escape' }),
      });
  
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_runtime_id' });
    });
  
  it('closes active SSE connections during runtime shutdown', async () => {
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Shutdown stream' }),
      });
      const stream = await harness.openRuntimeEventStream(thread.id, thread.lastSeq);
  
      await expect(withTimeout(harness.server.close(), 2_000, 'Runtime close timed out with an active SSE stream')).resolves.toBeUndefined();
      await stream.close();
    });
  
  it('updates thread memory mode through the runtime API', async () => {
      const created = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Memory mode' }),
      });
  
      expect(created).toMatchObject({ title: 'Memory mode', memoryMode: 'enabled' });
  
      const updated = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(created.id)}/memory-mode`, {
        method: 'PATCH',
        body: JSON.stringify({ mode: 'enabled' }),
      });
      const list = await harness.runtimeFetch('/v1/threads');
  
      expect(updated).toMatchObject({ id: created.id, memoryMode: 'enabled' });
      expect(list.threads).toMatchObject([{ id: created.id, memoryMode: 'enabled' }]);
    });
  
  it('updates thread memory mode through the AppServer RPC', async () => {
      const started = await harness.appServerRpc('thread/start', { name: 'AppServer memory mode', cwd: process.cwd() });
  
      await expect(harness.appServerRpc('thread/memoryMode/set', {
        threadId: started.thread.id,
        mode: 'disabled',
      })).resolves.toEqual({});
  
      await expect(harness.runtimeFetch(`/v1/threads/${encodeURIComponent(started.thread.id)}`)).resolves.toMatchObject({
        id: started.thread.id,
        memoryMode: 'disabled',
      });
  
      await expect(harness.appServerRpc('thread/memoryMode/set', {
        thread_id: started.thread.id,
        mode: 'enabled',
      })).resolves.toEqual({});
  
      await expect(harness.runtimeFetch(`/v1/threads/${encodeURIComponent(started.thread.id)}`)).resolves.toMatchObject({
        id: started.thread.id,
        memoryMode: 'enabled',
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'invalid_memory_mode',
        method: 'thread/memoryMode/set',
        params: { threadId: started.thread.id, mode: 'polluted' },
      })).resolves.toMatchObject({
        id: 'invalid_memory_mode',
        error: { code: -32602, message: 'mode must be enabled or disabled' },
      });
    });
});
