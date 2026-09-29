import { RUNTIME_LOCAL_ATTACHMENT_LINK_PATH } from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IN_MEMORY_RASTER_IMAGE_BYTES } from '../../../src/utils/safe-image.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createDelayedOpenAiCaptureServer,
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

  it.each(['local', 'worktree'])('starts a new chat in its selected %s workspace and sends its first turn there', async (workspaceMode) => {
    const repository = path.join(harness.runtimeDataDir, 'repository');
    const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: repository })).stdout;
    await mkdir(repository);
    await git('init');
    await writeFile(path.join(repository, 'file.txt'), 'committed');
    await git('add', '.');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial');
    await writeFile(path.join(repository, 'file.txt'), 'local edit');
    await writeFile(path.join(repository, 'new.txt'), 'untracked');
    const project = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: repository }) });
    const branchesBefore = await git('branch', '--list');
    const worktreesBefore = await git('worktree', 'list', '--porcelain');
    const statusBefore = await git('status', '--porcelain');
    const thread = await harness.runtimeFetch('/v1/threads', {
      method: 'POST', body: JSON.stringify({ title: 'Work location test', projectId: project.id, workspaceMode }),
    });
    const workspace = await harness.runtimeFetch(`/v1/workspace/status?threadId=${thread.id}`);
    expect(thread.projectId).toBe(project.id);
    expect(thread.messages).toEqual([]);
    expect((await harness.runtimeFetch('/v1/projects')).projects).toHaveLength(1);
    expect(await git('branch', '--list')).toBe(branchesBefore);
    expect(await git('status', '--porcelain')).toBe(statusBefore);
    if (workspaceMode === 'worktree') {
      expect(thread.workspaceId).toBe(workspace.project.id);
      expect(workspace.project.path).not.toBe(await realpath(repository));
      const branch = await promisify(execFile)('git', ['branch', '--show-current'], { cwd: workspace.project.path });
      expect(branch.stdout.trim()).toBe('');
    } else {
      expect(thread.workspaceId).toBeUndefined();
      expect(workspace.project.path).toBe(await realpath(repository));
      expect(await git('worktree', 'list', '--porcelain')).toBe(worktreesBefore);
    }
    expect(await readFile(path.join(workspace.project.path, 'file.txt'), 'utf8')).toBe('local edit');
    expect(await readFile(path.join(workspace.project.path, 'new.txt'), 'utf8')).toBe('untracked');
    const capture = await createOpenAiCaptureServer();
    try {
      await harness.configureOpenAiProvider('new-chat-location', capture.baseUrl);
      await harness.runtimeFetch(`/v1/threads/${thread.id}/turns`, { method: 'POST', body: JSON.stringify({ input: 'First message' }) });
      const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Waiting for first turn');
      expect(flattenStringValues(request.messages).join('\n')).toContain(workspace.project.path);
    } finally {
      await capture.close();
    }
  });

  it.each(['workspace', 'worktree'])('forks to %s at a REST boundary and continues in the correct workspace', async (target) => {
    let projectId: string | undefined;
    if (target === 'worktree') {
      const repository = path.join(harness.runtimeDataDir, 'repository');
      await mkdir(repository);
      const git = promisify(execFile);
      await git('git', ['init'], { cwd: repository });
      await git('git', ['-c', 'user.name=Fork test', '-c', 'user.email=fork@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial'], { cwd: repository });
      projectId = (await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: repository }) })).id;
    }
    const source = await harness.runtimeFetch('/v1/threads', { method: 'POST', body: JSON.stringify({ title: 'Fork source', projectId }) });
    await harness.appServerRpc('thread/inject_items', {
      threadId: source.id,
      items: [
        { id: 'question', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Question' }] },
        { id: 'answer', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Answer' }] },
        { id: 'later', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Later question' }] },
      ],
    });
    const before = await harness.runtimeFetch(`/v1/threads/${source.id}`);
    const forked = await harness.runtimeFetch(`/v1/threads/${source.id}/fork`, {
      method: 'POST', body: JSON.stringify({ messageId: before.messages[1].id, target }),
    });
    expect(forked.forkedFromId).toBe(source.id);
    expect(forked.projectId).toBe(source.projectId);
    const workspace = await harness.runtimeFetch(`/v1/workspace/status?threadId=${forked.id}`);
    if (target === 'worktree') {
      expect(workspace.project.id).toBe(forked.workspaceId);
      const list = await harness.runtimeFetch(`/v1/threads?projectId=${projectId}`);
      expect(list.threads.find((thread: { id: string }) => thread.id === forked.id))
        .toMatchObject({ projectId, workspaceId: forked.workspaceId });
      expect(list.threads.find((thread: { id: string }) => thread.id === source.id).workspaceId).toBeUndefined();
      expect((await harness.runtimeFetch('/v1/projects')).projects).toHaveLength(1);
    }
    expect(forked.messages.map((message: { content: string }) => message.content)).toEqual(['Question', 'Answer']);
    expect(await harness.runtimeFetch(`/v1/threads/${source.id}`)).toEqual(before);
    const response = await fetch(`${harness.baseUrl}/v1/threads/${source.id}/fork`, {
      method: 'POST', headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'answer', target: 'arbitrary-path' }),
    });
    expect(response.status).toBe(400);
    expect((await harness.runtimeFetch('/v1/threads')).threads).toHaveLength(2);
    const capture = await createOpenAiCaptureServer();
    try {
      await harness.configureOpenAiProvider('fork-continuation', capture.baseUrl);
      await harness.runtimeFetch(`/v1/threads/${forked.id}/turns`, { method: 'POST', body: JSON.stringify({ input: 'Continue the branch' }) });
      const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Waiting for fork continuation');
      const history = JSON.stringify(request.messages);
      expect(history).toContain('Question');
      expect(history).toContain('Answer');
      expect(history).toContain('Continue the branch');
      expect(history).not.toContain('Later question');
      expect(flattenStringValues(request.messages).join('\n')).toContain(workspace.project.path);
      expect(await harness.runtimeFetch(`/v1/threads/${source.id}`)).toEqual(before);
    } finally {
      await capture.close();
    }
  });

  it('reconnects a conversation with a removed worktree to its project and continues with its history', async () => {
    const repository = path.join(harness.runtimeDataDir, 'repository');
    await mkdir(repository);
    const git = async (...args: string[]) => promisify(execFile)('git', args, { cwd: repository });
    await git('init');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-m', 'Initial');
    const project = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: repository }) });
    const thread = await harness.runtimeFetch('/v1/threads', {
      method: 'POST', body: JSON.stringify({ title: 'Recovered workspace', projectId: project.id, workspaceMode: 'worktree' }),
    });
    await harness.appServerRpc('thread/inject_items', {
      threadId: thread.id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Preserve this requirement' }] }],
    });
    const before = await harness.runtimeFetch(`/v1/threads/${thread.id}`);
    const workspace = await harness.runtimeFetch(`/v1/workspace/status?threadId=${thread.id}`);
    await git('worktree', 'remove', workspace.project.path);
    expect(await harness.runtimeFetch(`/v1/workspace/status?threadId=${thread.id}`))
      .toMatchObject({ project: { id: thread.workspaceId }, exists: false, readable: false });
    const reset = () => harness.runtimeFetch(`/v1/threads/${thread.id}`, {
      method: 'PATCH', body: JSON.stringify({ workspaceId: null }),
    });
    await expect(harness.runtimeFetch(`/v1/threads/${thread.id}`, {
      method: 'PATCH', body: JSON.stringify({ workspaceId: 'arbitrary-workspace' }),
    })).rejects.toThrow('workspaceId can only be cleared');
    // Do not drop the binding if the fallback project is also unavailable.
    await rename(repository, `${repository}-moved`);
    await expect(reset()).rejects.toThrow('project directory is unavailable');
    expect((await harness.runtimeFetch(`/v1/threads/${thread.id}`)).workspaceId).toBe(thread.workspaceId);
    await rename(`${repository}-moved`, repository);
    await rm(path.join(harness.runtimeDataDir, 'runtime', 'worktrees', `${thread.workspaceId.slice('worktree_'.length)}.json`));
    expect(await harness.runtimeFetch(`/v1/workspace/status?threadId=${thread.id}`))
      .toMatchObject({ exists: false, readable: false });
    const recovered = await reset();
    expect(recovered.workspaceId).toBeUndefined();
    expect(recovered.projectId).toBe(project.id);
    expect(recovered.messages).toEqual(before.messages);
    expect(await harness.readEventStreamContains(thread.id, before.lastSeq, '"workspaceId":null')).toBe(true);
    expect((await harness.runtimeFetch('/v1/threads')).threads[0].workspaceId).toBeUndefined();
    expect((await harness.runtimeFetch(`/v1/workspace/status?threadId=${thread.id}`)).project.path).toBe(await realpath(repository));
    const capture = await createOpenAiCaptureServer();
    try {
      await harness.configureOpenAiProvider('recovered-workspace', capture.baseUrl);
      await harness.runtimeFetch(`/v1/threads/${thread.id}/turns`, { method: 'POST', body: JSON.stringify({ input: 'Continue here' }) });
      const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Waiting for recovered conversation');
      const context = flattenStringValues(request.messages).join('\n');
      expect(context).toContain('Preserve this requirement');
      expect(context).toContain(await realpath(repository));
      expect(context).not.toContain(workspace.project.path);
    } finally {
      await capture.close();
    }
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

  it('returns invalid_input for malformed REST goal patches', async () => {
      const created = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Invalid REST goal patch' }),
      });
      const response = await fetch(
        `${harness.baseUrl}/v1/features/goal/threads/${encodeURIComponent(created.id)}/state`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${harness.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ patch: { status: 'bogus' } }),
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'INVALID_INPUT',
        error: 'Feature operation input is invalid.',
      });
      await expect(
        harness.runtimeFetch(`/v1/features/goal/threads/${encodeURIComponent(created.id)}/state`),
      ).resolves.toMatchObject({ state: { goal: null } });
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
  
  it.each(['linked', 'pasted'])('claims a %s text attachment for a turn without granting additional write access', async (source) => {
      const capture = await createOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('attachment-provider', capture.baseUrl);
        const sourceDirectory = path.join(harness.runtimeDataDir, 'local-files');
        const sourcePath = path.join(sourceDirectory, 'notes.txt');
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, 'plugin-readable local file');
        const attachmentPath = source === 'linked'
          ? RUNTIME_LOCAL_ATTACHMENT_LINK_PATH
          : `/v1/attachments?${new URLSearchParams({ name: 'notes.txt', type: 'text/plain' })}`;
        const link = await fetch(`${harness.baseUrl}${attachmentPath}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': source === 'linked' ? 'application/json' : 'application/octet-stream' },
          body: source === 'linked'
            ? JSON.stringify({ path: sourcePath, type: 'text/plain' })
            : Buffer.from('plugin-readable pasted text'),
        });
        expect(link.status).toBe(201);
        const attachment = await link.json();
        const attachmentSourcePath = source === 'linked'
          ? await realpath(sourcePath)
          : path.join(harness.runtimeDataDir, 'runtime', 'attachments', 'files', attachment.assetId, 'notes.txt');
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Attachment context' }),
        });
  
        const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ input: source === 'linked' ? 'Summarize the attached document.' : '', attachments: [attachment] }),
        });
        const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for attachment model request');
        const serializedMessages = JSON.stringify(request.messages ?? []);
        const messageText = flattenStringValues(request.messages ?? []).join('\n');
        const updated = await harness.waitForThread(
          thread.id,
          (item) => item.messages.some((message) => message.turnId === started.turnId && message.role === 'user'),
        );
  
        expect(serializedMessages).toContain('User attachments available to this thread');
        expect(serializedMessages).toContain('notes.txt');
        expect(messageText).toContain(JSON.stringify(attachmentSourcePath).slice(1, -1));
        expect(messageText).toContain('do not grant additional write access');
        expect(messageText).toContain('Existing workspace permissions still apply');
        expect(messageText).not.toContain('plugin-readable local file');
        expect(messageText).not.toContain('plugin-readable pasted text');
        expect(updated.messages.find((message) => message.turnId === started.turnId && message.role === 'user'))
          .toMatchObject({ attachments: [expect.objectContaining({ source: 'runtime', name: 'notes.txt' })] });
      } finally {
        await capture.close();
      }
    });

  it('sends stored images to non-vision models as paths instead of provider image parts', async () => {
      const capture = await createOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('non-vision-attachment-provider', capture.baseUrl, { supportsImages: false });
        const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
        const query = new URLSearchParams({ name: 'diagram.png', type: 'image/png' });
        const upload = await fetch(`${harness.baseUrl}/v1/attachments?${query}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/octet-stream' },
          body: imageBytes,
        });
        expect(upload.status).toBe(201);
        const attachment = await upload.json();
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Non-vision image attachment' }),
        });

        await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ input: 'Please inspect the attached image.', attachments: [attachment] }),
        });
        const request = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for image attachment model request');
        const serializedRequest = JSON.stringify(request);

        expect(serializedRequest).toContain('User attachments available to this thread');
        expect(serializedRequest).toContain('diagram.png');
        expect(serializedRequest).not.toContain('input_image');
        expect(serializedRequest).not.toContain('image_url');
        expect(serializedRequest).not.toContain('iVBOR');

        const preview = await fetch(
          `${harness.baseUrl}/v1/threads/${encodeURIComponent(thread.id)}/attachments/${encodeURIComponent(attachment.assetId)}/image`,
          { headers: { Authorization: `Bearer ${harness.token}` } },
        );
        expect(preview.status).toBe(200);
        expect(preview.headers.get('content-type')).toBe('image/png');
        await expect(preview.arrayBuffer()).resolves.toEqual(imageBytes.buffer.slice(
          imageBytes.byteOffset,
          imageBytes.byteOffset + imageBytes.byteLength,
        ));

        const unrelatedThread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Unrelated image attachment thread' }),
        });
        const deniedPreview = await fetch(
          `${harness.baseUrl}/v1/threads/${encodeURIComponent(unrelatedThread.id)}/attachments/${encodeURIComponent(attachment.assetId)}/image`,
          { headers: { Authorization: `Bearer ${harness.token}` } },
        );
        expect(deniedPreview.status).toBe(404);
      } finally {
        await capture.close();
      }
    });

  it('keeps oversized linked images path-readable without loading them for provider or preview', async () => {
      const capture = await createOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('oversized-image-provider', capture.baseUrl);
        const sourceDirectory = path.join(harness.runtimeDataDir, 'large-local-images');
        const sourcePath = path.join(sourceDirectory, 'large.png');
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        await truncate(sourcePath, MAX_IN_MEMORY_RASTER_IMAGE_BYTES + 1);
        const canonicalSourcePath = await realpath(sourcePath);
        const link = await fetch(`${harness.baseUrl}${RUNTIME_LOCAL_ATTACHMENT_LINK_PATH}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${harness.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: sourcePath, type: 'image/png' }),
        });
        expect(link.status).toBe(201);
        const attachment = await link.json();
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'Oversized linked image' }),
        });

        await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ input: 'Inspect the attached image.', attachments: [attachment] }),
        });
        const request = await withTimeout(
          capture.nextBody,
          harness.providerCaptureTimeoutMs,
          'Timed out waiting for oversized image model request',
        );
        const serializedRequest = JSON.stringify(request);
        expect(flattenStringValues(request.messages ?? []).join('\n'))
          .toContain(JSON.stringify(canonicalSourcePath).slice(1, -1));
        expect(serializedRequest).not.toContain('input_image');
        expect(serializedRequest).not.toContain('image_url');

        const preview = await fetch(
          `${harness.baseUrl}/v1/threads/${encodeURIComponent(thread.id)}/attachments/${encodeURIComponent(attachment.assetId)}/image`,
          { headers: { Authorization: `Bearer ${harness.token}` } },
        );
        expect(preview.status).toBe(413);
        await expect(preview.json()).resolves.toMatchObject({ code: 'attachment_too_large' });
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

      const paged = await harness.runtimeFetch(
        `/v1/threads/${encodeURIComponent(created.id)}?messageLimit=2`,
      );
      const messages = await harness.runtimeFetch(
        `/v1/threads/${encodeURIComponent(created.id)}/messages?limit=2`,
      );
      expect(paged).toMatchObject({
        id: created.id,
        messages: [],
        messagePage: { nextBefore: null, total: 0 },
      });
      expect(messages).toEqual({ messages: [], nextBefore: null, total: 0 });
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

  it('updates and clears Goal Feature state, then deletes the Core thread', async () => {
      const created = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'REST thread commands' }),
      });
      const threadPath = `/v1/threads/${encodeURIComponent(created.id)}`;
      const goalPath = `/v1/features/goal/threads/${encodeURIComponent(created.id)}/state`;

      const goalResult = await harness.runtimeFetch(goalPath, {
        method: 'PATCH',
        body: JSON.stringify({
          patch: {
            objective: 'Keep the first-party runtime boundary small.',
            status: 'paused',
          },
        }),
      });
      expect(goalResult).toMatchObject({
        state: {
          goal: {
            threadId: created.id,
            objective: 'Keep the first-party runtime boundary small.',
            status: 'paused',
            tokenBudget: null,
          },
        },
      });
      await expect(harness.runtimeFetch(goalPath)).resolves.toMatchObject({
        state: { goal: expect.objectContaining({ objective: goalResult.state.goal.objective }) },
      });
      await expect(harness.runtimeFetch(threadPath)).resolves.not.toHaveProperty('goal');
      await expect(harness.runtimeFetch(goalPath, {
        method: 'PATCH',
        body: JSON.stringify({ patch: { objective: 'Unsupported budget', tokenBudget: 1_000 } }),
      })).rejects.toThrow('Feature operation input is invalid.');

      const clearedResult = await harness.runtimeFetch(goalPath, {
        method: 'DELETE',
      });
      expect(clearedResult).toMatchObject({
        state: { goal: null },
      });
      const emptyClearResult = await harness.runtimeFetch(goalPath, {
        method: 'DELETE',
      });
      expect(emptyClearResult).toMatchObject({
        state: { goal: null },
      });

      await expect(harness.runtimeFetch(threadPath, {
        method: 'DELETE',
      })).resolves.toEqual({ ok: true });
      const threads = await harness.runtimeFetch('/v1/threads?includeArchived=true');
      expect(threads.threads.some((thread: { id: string }) => thread.id === created.id)).toBe(false);
    });

  it('maps missing Goal threads and queued Goal conflicts to declared business errors', async () => {
    const missing = await fetch(`${harness.baseUrl}/v1/features/goal/threads/thread_missing/state`, {
      headers: { Authorization: `Bearer ${harness.token}` },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      code: 'THREAD_NOT_FOUND',
      error: 'Thread not found.',
      retryable: false,
    });

    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await harness.configureOpenAiProvider('goal-conflict-provider', capture.baseUrl);
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Goal conflict mapping' }),
      });
      await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Keep this turn active.' }),
      });
      await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for Goal conflict provider request');
      const queued = await harness.runtimeFetch(
        `/v1/threads/${encodeURIComponent(thread.id)}/queued-turn-inputs`,
        {
          method: 'POST',
          body: JSON.stringify({ input: 'Queued Goal', kind: 'goal' }),
        },
      );

      const conflict = await fetch(
        `${harness.baseUrl}/v1/features/goal/threads/${encodeURIComponent(thread.id)}/state`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${harness.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ patch: { objective: 'Conflicting Goal', status: 'active' } }),
        },
      );
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({
        code: 'GOAL_CONFLICT',
        retryable: false,
      });

      await harness.runtimeFetch(
        `/v1/threads/${encodeURIComponent(thread.id)}/queued-turn-inputs/${encodeURIComponent(queued.queuedInputId)}`,
        { method: 'DELETE' },
      );
      capture.release();
      await harness.waitForThread(thread.id, (item) => item.activeTurnId === null);
    } finally {
      capture.release();
      await capture.close();
    }
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

function flattenStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStringValues);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(flattenStringValues);
}
