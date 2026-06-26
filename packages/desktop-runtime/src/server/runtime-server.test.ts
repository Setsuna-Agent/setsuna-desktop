import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServer, type RuntimeServer } from './runtime-server.js';

describe('runtime server', () => {
  let server: RuntimeServer;
  let baseUrl: string;
  const token = 'test-token';

  beforeEach(async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-test-'));
    server = await createRuntimeServer({ dataDir, token, version: 'test' });
    await server.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await server.close();
  });

  it('creates and lists local and project threads', async () => {
    const created = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Smoke' }),
    });
    const projectThread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Project smoke', projectId: 'project_1' }),
    });

    expect(created.title).toBe('Smoke');
    expect(projectThread).toMatchObject({ title: 'Project smoke', projectId: 'project_1' });

    const list = await runtimeFetch('/v1/threads');
    const globalList = await runtimeFetch('/v1/threads?scope=global');
    const projectList = await runtimeFetch('/v1/threads?projectId=project_1');

    expect(list.threads.map((thread: { id: string }) => thread.id).sort()).toEqual([created.id, projectThread.id].sort());
    expect(globalList.threads).toMatchObject([{ id: created.id }]);
    expect(projectList.threads).toMatchObject([{ id: projectThread.id }]);
  });

  it('renames and archives local threads through the runtime API', async () => {
    const created = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Draft title' }),
    });

    const renamed = await runtimeFetch(`/v1/threads/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed title' }),
    });
    const archived = await runtimeFetch(`/v1/threads/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });
    const defaultList = await runtimeFetch('/v1/threads');
    const archivedList = await runtimeFetch('/v1/threads?includeArchived=true');

    expect(renamed).toMatchObject({ id: created.id, title: 'Renamed title' });
    expect(archived).toMatchObject({ id: created.id, archived: true });
    expect(defaultList.threads).toEqual([]);
    expect(archivedList.threads).toMatchObject([{ id: created.id, title: 'Renamed title', archived: true }]);
  });

  it('returns masked config without leaking API keys', async () => {
    const config = await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI compatible',
            provider: 'openai-compatible',
            baseUrl: 'https://example.com/v1/',
            apiKey: 'sk-example-secret',
            models: [{ id: 'gpt', name: 'GPT', code: 'gpt-test', enabled: true, maxOutputTokens: 1000, thinkingEnabled: false, thinkingEfforts: [] }],
          },
        ],
      }),
    });

    expect(JSON.stringify(config)).not.toContain('sk-example-secret');
    expect(config.providers[0].baseUrl).toBe('https://example.com/v1');
    expect(config.providers[0].apiKeySet).toBe(true);
  });

  it('fetches local provider models through the runtime API', async () => {
    const modelServer = await createModelListCaptureServer();
    try {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'local-models',
          providers: [
            {
              id: 'local-models',
              name: 'Local models',
              provider: 'openai-compatible',
              baseUrl: modelServer.baseUrl,
              apiKey: 'sk-model-list',
              enabled: true,
              models: [{ id: 'placeholder', name: 'Placeholder', code: 'placeholder', enabled: true, maxOutputTokens: 1000, thinkingEnabled: false, thinkingEfforts: [] }],
            },
          ],
        }),
      });

      const result = await runtimeFetch('/v1/config/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'local-models' }),
      });
      const request = await modelServer.nextRequest;

      expect(request.url).toBe('/models');
      expect(request.authorization).toBe('Bearer sk-model-list');
      expect(result.models).toEqual([
        { id: 'llama3.1', name: 'Llama 3.1' },
        { id: 'qwen2.5', name: 'qwen2.5', thinkingEnabled: true, thinkingEfforts: ['low', 'high'], supportsImages: true },
      ]);
    } finally {
      await modelServer.close();
    }
  });

  it('lists and updates local skills', async () => {
    const list = await runtimeFetch('/v1/skills');
    expect(list.skills.some((skill: { id: string }) => skill.id === 'presentation-mcp')).toBe(true);

    const updated = await runtimeFetch('/v1/skills/presentation-mcp', {
      method: 'PATCH',
      body: JSON.stringify({ selected: true }),
    });

    expect(updated).toMatchObject({
      id: 'presentation-mcp',
      selected: true,
      enabled: true,
    });
  });

  it('exposes local project status and read-only file APIs', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-server-project-'));
    await mkdir(path.join(projectDir, 'src'), { recursive: true });
    await writeFile(path.join(projectDir, 'src', 'note.txt'), 'server-side local search target\n');

    const project = await runtimeFetch('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ path: projectDir, name: 'Server fixture' }),
    });
    const status = await runtimeFetch(`/v1/workspace/status?projectId=${encodeURIComponent(project.id)}`);
    const entries = await runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/files?path=src`);
    const entrySearch = await runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/entries/search?q=src%2Fnote`);
    const rootEntries = await runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/entries/search?q=&parent=`);
    const file = await runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/read?path=src%2Fnote.txt`);
    const search = await runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/search?q=target`);

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

  it('exposes local usage summaries', async () => {
    const usage = await runtimeFetch('/v1/usage');

    expect(usage).toMatchObject({
      records: [],
      summary: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        recordCount: 0,
        byProvider: [],
        byModel: [],
      },
    });
  });

  it('exposes local approval queue', async () => {
    const approvals = await runtimeFetch('/v1/approvals');

    expect(approvals).toEqual({ approvals: [] });
  });

  it('starts turns with ids and accepts cancellation requests', async () => {
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Cancelable' }),
    });

    const started = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: 'start a local smoke turn' }),
    });
    const cancelled = await runtimeFetch(
      `/v1/threads/${encodeURIComponent(thread.id)}/turns/${encodeURIComponent(started.turnId)}/cancel`,
      { method: 'POST' },
    );

    expect(started).toMatchObject({ accepted: true });
    expect(typeof started.turnId).toBe('string');
    expect(cancelled).toMatchObject({ ok: true });
    expect(typeof cancelled.cancelled).toBe('boolean');
  });

  it('passes per-turn skill ids through the runtime API', async () => {
    const capture = await createOpenAiCaptureServer();
    try {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'capture-provider',
          providers: [
            {
              id: 'capture-provider',
              name: 'Capture provider',
              provider: 'openai-compatible',
              baseUrl: capture.baseUrl,
              apiKey: 'sk-capture',
              enabled: true,
              models: [
                {
                  id: 'capture-model',
                  name: 'Capture model',
                  code: 'capture-model',
                  enabled: true,
                  maxOutputTokens: 1000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                },
              ],
            },
          ],
        }),
      });
      const skill = await runtimeFetch('/v1/skills', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Runtime API Skill',
          content: '# Runtime API Skill\n\nInjected via per-turn skill ids.',
          selected: false,
        }),
      });
      const thread = await runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Skill API' }),
      });

      const started = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Use the API skill.', skillIds: [skill.id] }),
      });
      const body = await withTimeout(capture.nextBody, 1500, 'Timed out waiting for captured provider request');
      const messages = Array.isArray(body.messages) ? body.messages : [];

      expect(started).toMatchObject({ accepted: true });
      expect(body.model).toBe('capture-model');
      expect(messages[0]).toMatchObject({ role: 'system' });
      expect(String((messages[0] as { content?: unknown }).content)).toContain('Injected via per-turn skill ids.');
    } finally {
      await capture.close();
    }
  });

  it('clears thread context through the runtime API and exposes the event stream update', async () => {
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Clear context' }),
    });
    await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: 'Write a local smoke response.' }),
    });
    const populated = await waitForThread(thread.id, (item) => item.messages.some((message) => message.role === 'assistant' && message.status === 'complete'));

    const cleared = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/context`, { method: 'DELETE' });
    const hasClearedEvent = await readRuntimeEvent(thread.id, populated.lastSeq, 'thread.context_cleared');

    expect(populated.messageCount).toBeGreaterThan(0);
    expect(cleared).toMatchObject({ id: thread.id, messageCount: 0, lastMessagePreview: '', messages: [] });
    expect(hasClearedEvent).toBe(true);
  });

  it('updates, deletes, and regenerates thread messages through the runtime API', async () => {
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Message actions' }),
    });
    await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: 'Original prompt.' }),
    });
    const populated = await waitForThread(thread.id, (item) => item.messages.some((message) => message.role === 'assistant' && message.status === 'complete'));
    const userMessage = populated.messages.find((message) => message.role === 'user');
    const assistantMessage = populated.messages.find((message) => message.role === 'assistant');

    if (!userMessage || !assistantMessage) throw new Error('Expected a completed user/assistant exchange.');

    const edited = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/messages/${encodeURIComponent(userMessage.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'Edited prompt.' }),
    });
    expect(edited.messages.find((message: { id: string }) => message.id === userMessage.id)).toMatchObject({ content: 'Edited prompt.' });

    const deleted = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/messages`, {
      method: 'DELETE',
      body: JSON.stringify({ messageIds: [assistantMessage.id] }),
    });
    expect(deleted.messages.some((message: { id: string }) => message.id === assistantMessage.id)).toBe(false);

    const regenerated = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/messages/${encodeURIComponent(userMessage.id)}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Regenerated prompt.' }),
    });
    const rerun = await waitForThread(
      thread.id,
      (item) => item.messages.some((message) => message.turnId === regenerated.turnId && message.role === 'assistant' && message.status === 'complete'),
    );

    expect(rerun.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['Regenerated prompt.']);
    expect(rerun.messages.some((message) => message.id === assistantMessage.id)).toBe(false);
  });

  it('stores and deletes local memories', async () => {
    const created = await runtimeFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'Use local memory only.', scope: 'global' }),
    });
    const list = await runtimeFetch('/v1/memories?search=local');

    expect(created.memories[0]).toMatchObject({ scope: 'global', content: 'Use local memory only.' });
    expect(list.memories).toMatchObject([{ id: created.memories[0].id }]);

    await runtimeFetch(`/v1/memories/${encodeURIComponent(created.memories[0].id)}`, { method: 'DELETE' });
    await expect(runtimeFetch('/v1/memories')).resolves.toMatchObject({ memories: [] });
  });

  it('stores local MCP server config through the runtime API', async () => {
    const created = await runtimeFetch('/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({
        key: 'docs',
        label: 'Docs',
        transport: 'streamableHttp',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer secret' },
      }),
    });
    const updated = await runtimeFetch('/v1/mcp/servers/docs', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });

    expect(created.servers[0]).toMatchObject({
      key: 'docs',
      transport: 'streamableHttp',
      headerKeys: ['Authorization'],
    });
    expect(JSON.stringify(created)).not.toContain('Bearer secret');
    expect(updated.servers[0]).toMatchObject({ enabled: false });

    await runtimeFetch('/v1/mcp/servers/docs', { method: 'DELETE' });
    await expect(runtimeFetch('/v1/mcp/servers')).resolves.toMatchObject({ servers: [] });
  });

  async function runtimeFetch(pathname: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async function waitForThread(threadId: string, predicate: (thread: RuntimeThread) => boolean): Promise<RuntimeThread> {
    const deadline = Date.now() + 3000;
    let lastThread: RuntimeThread | undefined;
    while (Date.now() < deadline) {
      const currentThread = (await runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
      lastThread = currentThread;
      if (predicate(currentThread)) return currentThread;
      await sleep(25);
    }
    throw new Error(`Timed out waiting for thread state: ${JSON.stringify(lastThread)}`);
  }

  async function readRuntimeEvent(threadId: string, sinceSeq: number, type: string): Promise<boolean> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/v1/threads/${encodeURIComponent(threadId)}/events?sinceSeq=${sinceSeq}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    if (!response.body) throw new Error('Expected runtime event response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + 1500;
    try {
      while (Date.now() < deadline) {
        const result = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => null)]);
        if (!result) break;
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        if (buffer.includes(`"type":"${type}"`)) return true;
      }
      return false;
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  }
});

async function createOpenAiCaptureServer(): Promise<{
  baseUrl: string;
  nextBody: Promise<Record<string, unknown>>;
  close(): Promise<void>;
}> {
  let resolveBody: (body: Record<string, unknown>) => void = () => undefined;
  let rejectBody: (error: unknown) => void = () => undefined;
  const nextBody = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveBody = resolve;
    rejectBody = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      resolveBody(JSON.parse(await readRequestText(request)) as Record<string, unknown>);
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Captured.' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    } catch (error) {
      rejectBody(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for capture server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextBody,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function createModelListCaptureServer(): Promise<{
  baseUrl: string;
  nextRequest: Promise<{ authorization?: string; url?: string }>;
  close(): Promise<void>;
}> {
  let resolveRequest: (request: { authorization?: string; url?: string }) => void = () => undefined;
  const nextRequest = new Promise<{ authorization?: string; url?: string }>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((request, response) => {
    resolveRequest({
      authorization: request.headers.authorization,
      url: request.url,
    });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      data: [
        { id: 'llama3.1', display_name: 'Llama 3.1' },
        { model: 'qwen2.5', capabilities: { reasoning: true, reasoningEfforts: ['low', 'high'] }, modalities: ['text', 'image'] },
        { id: 'llama3.1', name: 'Duplicate' },
      ],
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for model list server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextRequest,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(message);
    }),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
