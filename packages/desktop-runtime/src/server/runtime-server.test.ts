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
    await startRuntimeServer(dataDir);
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

  it('settles persisted active turns when the runtime starts', async () => {
    await server.close();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-stale-test-'));
    const threadId = await seedStaleRuntimeThread(dataDir);

    await startRuntimeServer(dataDir);

    const thread = (await runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
    expect(thread.lastSeq).toBe(1);
    expect(thread.messages[0]).toMatchObject({
      status: 'complete',
      completedAt: expect.any(String),
      error: 'Turn cancelled because the desktop runtime restarted.',
    });
    expect(thread.messages[0].toolRuns?.[0]).toMatchObject({
      status: 'rejected',
      resultPreview: 'Turn cancelled because the desktop runtime restarted.',
      completedAt: expect.any(String),
    });
  });

  it('accepts AppServer app-server JSON-RPC shaped requests for the SWE path', async () => {
    const initialized = await appServerRpc('initialize', {
      clientInfo: { name: 'setsuna-test', version: 'test' },
      capabilities: null,
    });
    expect(initialized).toMatchObject({
      userAgent: 'setsuna-desktop/test',
      platformOs: expect.any(String),
      platformFamily: expect.any(String),
    });

    const startedThread = await appServerRpc('thread/start', { name: 'AppServer RPC thread', cwd: process.cwd() });
    expect(startedThread).toMatchObject({
      thread: {
        id: expect.any(String),
        name: 'AppServer RPC thread',
        status: { type: 'idle' },
        source: 'appServer',
        turns: [],
      },
      approvalPolicy: expect.anything(),
      sandbox: expect.objectContaining({ type: expect.any(String) }),
    });

    await expect(appServerRpc('thread/name/set', {
      threadId: startedThread.thread.id,
      name: 'Renamed AppServer RPC thread',
    })).resolves.toEqual({});
    await expect(appServerRpc('thread/compact/start', {
      threadId: startedThread.thread.id,
    })).resolves.toEqual({});

    const renamed = await appServerRpc('thread/read', { threadId: startedThread.thread.id });
    expect(renamed.thread).toMatchObject({
      id: startedThread.thread.id,
      name: 'Renamed AppServer RPC thread',
    });

    await expect(appServerRpc('thread/archive', { threadId: startedThread.thread.id })).resolves.toEqual({});
    const hiddenArchived = await appServerRpc('thread/list', {});
    expect(hiddenArchived.data.some((thread: { id: string }) => thread.id === startedThread.thread.id)).toBe(false);
    const listedArchived = await appServerRpc('thread/list', { archived: true });
    expect(listedArchived).toMatchObject({
      data: [expect.objectContaining({ id: startedThread.thread.id, name: 'Renamed AppServer RPC thread' })],
      nextCursor: null,
    });

    const unarchived = await appServerRpc('thread/unarchive', { threadId: startedThread.thread.id });
    expect(unarchived.thread).toMatchObject({
      id: startedThread.thread.id,
      name: 'Renamed AppServer RPC thread',
      status: { type: 'idle' },
    });
    const listed = await appServerRpc('thread/list', {});
    expect(listed).toMatchObject({
      data: [expect.objectContaining({ id: startedThread.thread.id, name: 'Renamed AppServer RPC thread' })],
      nextCursor: null,
    });

    await expect(readEventStreamContains(
      startedThread.thread.id,
      0,
      '"method":"thread/name/updated"',
      { format: 'swe' },
    )).resolves.toBe(true);
    await expect(readEventStreamContains(
      startedThread.thread.id,
      0,
      '"method":"thread/archived"',
      { format: 'swe' },
    )).resolves.toBe(true);
    await expect(readEventStreamContains(
      startedThread.thread.id,
      0,
      '"method":"thread/unarchived"',
      { format: 'swe' },
    )).resolves.toBe(true);

    const resumed = await appServerRpc('thread/resume', { threadId: startedThread.thread.id });
    expect(resumed).toMatchObject({
      thread: {
        id: startedThread.thread.id,
        status: { type: 'idle' },
      },
      model: expect.any(String),
      sandbox: expect.objectContaining({ type: expect.any(String) }),
    });

    const startedTurn = await appServerRpc('turn/start', {
      threadId: startedThread.thread.id,
      input: [{ type: 'text', text: 'Write a local smoke response.' }],
    });
    expect(startedTurn).toMatchObject({
      turn: {
        id: expect.any(String),
        status: 'inProgress',
        items: [],
      },
    });

    await waitForThread(
      startedThread.thread.id,
      (item) => item.messages.some((message) => message.turnId === startedTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
    );
    const read = await appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
    expect(read.thread.turns).toEqual([expect.objectContaining({
      id: startedTurn.turn.id,
      items: expect.arrayContaining([
        expect.objectContaining({ type: 'userMessage' }),
        expect.objectContaining({ type: 'agentMessage' }),
      ]),
    })]);
    const resumedWithTurns = await appServerRpc('thread/resume', { threadId: startedThread.thread.id });
    expect(resumedWithTurns.thread.turns).toEqual([expect.objectContaining({
      id: startedTurn.turn.id,
      items: expect.arrayContaining([
        expect.objectContaining({ type: 'userMessage' }),
        expect.objectContaining({ type: 'agentMessage' }),
      ]),
    })]);
    const resumedWithoutTurns = await appServerRpc('thread/resume', { threadId: startedThread.thread.id, excludeTurns: true });
    expect(resumedWithoutTurns.thread.turns).toEqual([]);

    const forked = await appServerRpc('thread/fork', {
      threadId: startedThread.thread.id,
      name: 'Forked AppServer RPC thread',
    });
    expect(forked.thread).toMatchObject({
      name: 'Forked AppServer RPC thread',
      forkedFromId: startedThread.thread.id,
      status: { type: 'idle' },
    });
    expect(forked.thread.turns).toEqual([expect.objectContaining({
      id: startedTurn.turn.id,
      items: expect.arrayContaining([
        expect.objectContaining({ type: 'userMessage' }),
        expect.objectContaining({ type: 'agentMessage' }),
      ]),
    })]);
  });

  it('lists loaded AppServer threads with cursor pagination', async () => {
    const firstThread = await appServerRpc('thread/start', { name: 'Loaded A', cwd: process.cwd() });
    const secondThread = await appServerRpc('thread/start', { name: 'Loaded B', cwd: process.cwd() });
    const expectedIds = [firstThread.thread.id, secondThread.thread.id].sort();

    await expect(appServerRpc('thread/loaded/list', {})).resolves.toEqual({
      data: expectedIds,
      nextCursor: null,
    });

    const firstPage = await appServerRpc('thread/loaded/list', { limit: 1 });
    expect(firstPage).toEqual({
      data: [expectedIds[0]],
      nextCursor: expectedIds[0],
    });
    await expect(appServerRpc('thread/loaded/list', { cursor: firstPage.nextCursor, limit: 1 })).resolves.toEqual({
      data: [expectedIds[1]],
      nextCursor: null,
    });
  });

  it('lists AppServer turns in upstream page order and supports initial resume pages', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Paged turns', cwd: process.cwd() });
    const firstTurn = await appServerRpc('turn/start', {
      threadId: startedThread.thread.id,
      input: [{ type: 'text', text: 'First paged turn.' }],
    });
    await waitForThread(
      startedThread.thread.id,
      (item) => item.messages.some((message) => message.turnId === firstTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
    );
    const secondTurn = await appServerRpc('turn/start', {
      threadId: startedThread.thread.id,
      input: [{ type: 'text', text: 'Second paged turn.' }],
    });
    await waitForThread(
      startedThread.thread.id,
      (item) => item.messages.some((message) => message.turnId === secondTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
    );

    const newestPage = await appServerRpc('thread/turns/list', {
      threadId: startedThread.thread.id,
      limit: 1,
    });
    expect(newestPage).toMatchObject({
      data: [
        {
          id: secondTurn.turn.id,
          itemsView: 'summary',
          items: [
            expect.objectContaining({ type: 'userMessage' }),
            expect.objectContaining({ type: 'agentMessage' }),
          ],
        },
      ],
      backwardsCursor: expect.any(String),
      nextCursor: expect.any(String),
    });
    expect(JSON.parse(newestPage.nextCursor)).toEqual({ turnId: secondTurn.turn.id, includeAnchor: false });
    expect(JSON.parse(newestPage.backwardsCursor)).toEqual({ turnId: secondTurn.turn.id, includeAnchor: true });

    const olderPage = await appServerRpc('thread/turns/list', {
      threadId: startedThread.thread.id,
      cursor: newestPage.nextCursor,
      limit: 1,
    });
    expect(olderPage).toMatchObject({
      data: [expect.objectContaining({ id: firstTurn.turn.id, itemsView: 'summary' })],
      nextCursor: null,
      backwardsCursor: expect.any(String),
    });

    await expect(appServerRpc('thread/turns/list', {
      threadId: startedThread.thread.id,
      sortDirection: 'asc',
      itemsView: 'notLoaded',
      limit: 2,
    })).resolves.toMatchObject({
      data: [
        { id: firstTurn.turn.id, items: [], itemsView: 'notLoaded' },
        { id: secondTurn.turn.id, items: [], itemsView: 'notLoaded' },
      ],
      nextCursor: null,
    });

    const resumed = await appServerRpc('thread/resume', {
      threadId: startedThread.thread.id,
      excludeTurns: true,
      initialTurnsPage: { limit: 1, sortDirection: 'asc', itemsView: 'notLoaded' },
    });
    expect(resumed.thread.turns).toEqual([]);
    expect(resumed.initialTurnsPage).toMatchObject({
      data: [{ id: firstTurn.turn.id, items: [], itemsView: 'notLoaded' }],
      nextCursor: expect.any(String),
      backwardsCursor: expect.any(String),
    });

    const firstTurnFirstItem = await appServerRpc('thread/items/list', {
      threadId: startedThread.thread.id,
      turnId: firstTurn.turn.id,
      limit: 1,
    });
    expect(firstTurnFirstItem).toMatchObject({
      data: [
        expect.objectContaining({
          type: 'userMessage',
          content: [{ type: 'text', text: 'First paged turn.' }],
        }),
      ],
      nextCursor: expect.any(String),
      backwardsCursor: expect.any(String),
    });
    expect(JSON.parse(firstTurnFirstItem.nextCursor)).toMatchObject({
      turnId: firstTurn.turn.id,
      includeAnchor: false,
    });

    const firstTurnRest = await appServerRpc('thread/items/list', {
      threadId: startedThread.thread.id,
      turnId: firstTurn.turn.id,
      cursor: firstTurnFirstItem.nextCursor,
      limit: 10,
    });
    expect(firstTurnRest).toMatchObject({
      data: [expect.objectContaining({ type: 'agentMessage' })],
      nextCursor: null,
      backwardsCursor: expect.any(String),
    });

    await expect(appServerRpc('thread/items/list', {
      threadId: startedThread.thread.id,
      limit: 1,
      sortDirection: 'desc',
    })).resolves.toMatchObject({
      data: [expect.objectContaining({ type: 'agentMessage' })],
      nextCursor: expect.any(String),
      backwardsCursor: expect.any(String),
    });

    await expect(appServerRpcEnvelope({
      id: 'bad_items_cursor',
      method: 'thread/items/list',
      params: { threadId: startedThread.thread.id, cursor: 'invalid' },
    })).resolves.toMatchObject({
      id: 'bad_items_cursor',
      error: { code: -32600, message: 'invalid cursor: invalid' },
    });
  });

  it('lists configured AppServer models with upstream catalog pagination', async () => {
    await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: 'catalog-openai',
        providers: [
          {
            id: 'catalog-openai',
            name: 'Catalog OpenAI',
            provider: 'openai-responses',
            baseUrl: 'https://api.openai.test/v1',
            apiKey: 'sk-catalog',
            enabled: true,
            models: [
              {
                id: 'alpha',
                name: 'GPT Alpha',
                code: 'gpt-alpha',
                enabled: true,
                maxOutputTokens: 2000,
                thinkingEnabled: true,
                thinkingEfforts: ['low', 'high'],
                defaultThinkingEffort: 'high',
                supportsImages: true,
              },
              {
                id: 'beta',
                name: 'GPT Beta',
                code: 'gpt-beta',
                enabled: false,
                maxOutputTokens: 2000,
                thinkingEnabled: false,
                thinkingEfforts: [],
              },
            ],
          },
        ],
      }),
    });

    await expect(appServerRpc('model/list', { limit: 1 })).resolves.toEqual({
      data: [
        {
          id: 'catalog-openai:alpha',
          model: 'gpt-alpha',
          upgrade: null,
          upgradeInfo: null,
          availabilityNux: null,
          displayName: 'GPT Alpha',
          description: 'Provider: Catalog OpenAI',
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'low', description: 'Low' },
            { reasoningEffort: 'high', description: 'High' },
          ],
          defaultReasoningEffort: 'high',
          inputModalities: ['text', 'image'],
          supportsPersonality: false,
          additionalSpeedTiers: [],
          serviceTiers: [],
          defaultServiceTier: null,
          isDefault: true,
        },
      ],
      nextCursor: null,
    });

    await expect(appServerRpc('model/list', { includeHidden: true, cursor: '1', limit: 1 })).resolves.toMatchObject({
      data: [
        {
          id: 'catalog-openai:beta',
          model: 'gpt-beta',
          hidden: true,
          defaultReasoningEffort: 'none',
          inputModalities: ['text'],
          isDefault: false,
        },
      ],
      nextCursor: null,
    });

    await expect(appServerRpcEnvelope({
      id: 'bad_model_cursor',
      method: 'model/list',
      params: { cursor: 'invalid' },
    })).resolves.toMatchObject({
      id: 'bad_model_cursor',
      error: { code: -32600, message: 'invalid cursor: invalid' },
    });
  });

  it('returns AppServer model provider capabilities for the active provider', async () => {
    await expect(appServerRpc('modelProvider/capabilities/read', {})).resolves.toEqual({
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true,
    });

    await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: 'anthropic-catalog',
        providers: [
          {
            id: 'anthropic-catalog',
            name: 'Anthropic Catalog',
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.test',
            apiKey: 'sk-ant',
            enabled: true,
            models: [
              {
                id: 'claude',
                name: 'Claude',
                code: 'claude-test',
                enabled: true,
                maxOutputTokens: 2000,
                thinkingEnabled: false,
                thinkingEfforts: [],
              },
            ],
          },
        ],
      }),
    });

    await expect(appServerRpc('modelProvider/capabilities/read', {})).resolves.toEqual({
      namespaceTools: true,
      imageGeneration: false,
      webSearch: false,
    });
  });

  it('lists AppServer permission profiles with upstream ids and cursor pagination', async () => {
    await expect(appServerRpc('permissionProfile/list', { limit: 2, cwd: process.cwd() })).resolves.toEqual({
      data: [
        { id: ':read-only', description: null, allowed: true },
        { id: ':workspace', description: null, allowed: true },
      ],
      nextCursor: '2',
    });

    await expect(appServerRpc('permissionProfile/list', { cursor: '2', limit: 2 })).resolves.toEqual({
      data: [
        { id: ':danger-full-access', description: null, allowed: true },
      ],
      nextCursor: null,
    });

    await expect(appServerRpcEnvelope({
      id: 'bad_permission_cursor',
      method: 'permissionProfile/list',
      params: { cursor: 'NaN' },
    })).resolves.toMatchObject({
      id: 'bad_permission_cursor',
      error: { code: -32600, message: 'invalid cursor: NaN' },
    });
  });

  it('reads AppServer v2 config with origins, layers, and feature enablement', async () => {
    await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: 'config-openai',
        globalPrompt: 'Prefer terse answers.',
        memoryEnabled: false,
        approvalPolicy: 'strict',
        permissionProfile: 'workspace-write',
        setsunaStyle: 'daily',
        providers: [
          {
            id: 'config-openai',
            name: 'Config OpenAI',
            provider: 'openai-responses',
            baseUrl: 'https://api.config.test/v1',
            apiKey: 'sk-config-secret',
            enabled: true,
            models: [
              {
                id: 'alpha',
                name: 'GPT Alpha',
                code: 'gpt-alpha',
                enabled: true,
                maxOutputTokens: 4000,
                thinkingEnabled: true,
                thinkingEfforts: ['low', 'high'],
                defaultThinkingEffort: 'high',
              },
            ],
          },
        ],
      }),
    });

    const response = await appServerRpc('config/read', { includeLayers: true, cwd: process.cwd() });
    expect(response.config).toMatchObject({
      model: 'gpt-alpha',
      model_provider: 'config-openai',
      approval_policy: 'untrusted',
      approvals_reviewer: 'user',
      sandbox_mode: 'workspace-write',
      instructions: 'Prefer terse answers.',
      model_reasoning_effort: 'high',
      features: {
        auth_elicitation: false,
        memories: false,
        mentions_v2: true,
        remote_control: false,
        remote_plugin: false,
        tool_suggest: true,
      },
      desktop: {
        setsuna_style: 'daily',
        memory_enabled: false,
      },
    });
    expect(response.config.sandbox_workspace_write).toMatchObject({
      writable_roots: [process.cwd()],
      network_access: false,
      exclude_tmpdir_env_var: false,
      exclude_slash_tmp: false,
    });
    expect(response.origins.model).toMatchObject({
      version: '1',
      name: {
        type: 'user',
        file: expect.stringContaining('config.json'),
        profile: null,
      },
    });
    expect(response.layers).toHaveLength(1);
    expect(response.layers[0]).toMatchObject({
      version: '1',
      name: { type: 'user', profile: null },
    });
    expect(JSON.stringify(response)).not.toContain('sk-config-secret');

    await expect(appServerRpc('config/read', {})).resolves.not.toHaveProperty('layers');
  });

  it('writes AppServer v2 config values and batches into local config state', async () => {
    await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: 'write-openai',
        providers: [
          {
            id: 'write-openai',
            name: 'Write OpenAI',
            provider: 'openai-compatible',
            baseUrl: 'https://api.write.test/v1',
            enabled: true,
            models: [
              {
                id: 'alpha',
                name: 'GPT Alpha',
                code: 'gpt-alpha',
                enabled: true,
                maxOutputTokens: 4000,
                thinkingEnabled: true,
                thinkingEfforts: ['medium'],
                defaultThinkingEffort: 'medium',
              },
              {
                id: 'beta',
                name: 'GPT Beta',
                code: 'gpt-beta',
                enabled: false,
                maxOutputTokens: 4000,
                thinkingEnabled: false,
                thinkingEfforts: [],
              },
            ],
          },
        ],
      }),
    });

    await expect(appServerRpc('config/value/write', {
      keyPath: 'model',
      value: 'gpt-beta',
      mergeStrategy: 'replace',
    })).resolves.toMatchObject({
      status: 'ok',
      version: '1',
      filePath: expect.stringContaining('config.json'),
      overriddenMetadata: null,
    });

    await expect(appServerRpc('config/batchWrite', {
      edits: [
        { keyPath: 'approval_policy', value: 'never', mergeStrategy: 'replace' },
        { keyPath: 'sandbox_mode', value: 'workspace-write', mergeStrategy: 'replace' },
        {
          keyPath: 'sandbox_workspace_write',
          value: { writable_roots: ['D:/work'], network_access: true },
          mergeStrategy: 'replace',
        },
        { keyPath: 'features.memories', value: false, mergeStrategy: 'replace' },
        { keyPath: 'desktop.selected-avatar-id', value: 'swe', mergeStrategy: 'replace' },
      ],
    })).resolves.toMatchObject({ status: 'ok', version: '1' });

    const read = await appServerRpc('config/read', {});
    expect(read.config).toMatchObject({
      model: 'gpt-beta',
      approval_policy: 'never',
      sandbox_mode: 'workspace-write',
      sandbox_workspace_write: {
        writable_roots: ['D:/work'],
        network_access: true,
      },
      features: {
        memories: false,
      },
      desktop: {
        'selected-avatar-id': 'swe',
        memory_enabled: false,
      },
    });
  });

  it('sets supported AppServer runtime feature enablement keys', async () => {
    await expect(appServerRpc('experimentalFeature/enablement/set', {
      enablement: {
        memories: false,
        mentions_v2: false,
        unsupported_feature: true,
      },
    })).resolves.toEqual({
      enablement: {
        memories: false,
        mentions_v2: false,
      },
    });

    const config = await appServerRpc('config/read', {});
    expect(config.config.features).toMatchObject({
      memories: false,
      mentions_v2: false,
    });

    const features = await appServerRpc('experimentalFeature/list', {});
    expect(features.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'memories', enabled: false }),
      expect.objectContaining({ name: 'mentions_v2', enabled: false }),
    ]));
  });

  it('rejects AppServer config writes with stale expected versions', async () => {
    await expect(appServerRpcEnvelope({
      id: 'stale_config_write',
      method: 'config/value/write',
      params: {
        keyPath: 'model',
        value: 'gpt-stale',
        mergeStrategy: 'replace',
        expectedVersion: 'sha256:stale',
      },
    })).resolves.toMatchObject({
      id: 'stale_config_write',
      error: {
        code: -32602,
        message: 'config version conflict: expected sha256:stale',
        data: { config_write_error_code: 'configVersionConflict' },
      },
    });
  });

  it('returns null AppServer config requirements when no managed layer exists', async () => {
    await expect(appServerRpc('configRequirements/read', {})).resolves.toEqual({ requirements: null });
  });

  it('lists AppServer experimental features with upstream metadata and cursor pagination', async () => {
    const firstPage = await appServerRpc('experimentalFeature/list', { limit: 2 });
    expect(firstPage).toMatchObject({
      data: [
        { name: 'undo', stage: 'removed', enabled: false, defaultEnabled: false },
        { name: 'shell_tool', stage: 'stable', enabled: true, defaultEnabled: true },
      ],
      nextCursor: '2',
    });

    const allFeatures = await appServerRpc('experimentalFeature/list', {});
    expect(allFeatures.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'memories',
        stage: 'beta',
        displayName: 'Memories',
        enabled: true,
        defaultEnabled: false,
      }),
      expect.objectContaining({
        name: 'apps',
        stage: 'stable',
        enabled: false,
        defaultEnabled: true,
      }),
      expect.objectContaining({
        name: 'prevent_idle_sleep',
        stage: 'beta',
        enabled: false,
        defaultEnabled: false,
      }),
    ]));

    await expect(appServerRpcEnvelope({
      id: 'bad_feature_cursor',
      method: 'experimentalFeature/list',
      params: { cursor: 'nope' },
    })).resolves.toMatchObject({
      id: 'bad_feature_cursor',
      error: { code: -32600, message: 'invalid cursor: nope' },
    });

    await expect(appServerRpcEnvelope({
      id: 'missing_feature_thread',
      method: 'experimentalFeature/list',
      params: { threadId: 'missing-thread' },
    })).resolves.toMatchObject({
      id: 'missing_feature_thread',
      error: { code: -32600, message: 'thread not found: missing-thread' },
    });
  });

  it('lists AppServer collaboration mode presets in upstream order', async () => {
    await expect(appServerRpc('collaborationMode/list', {})).resolves.toEqual({
      data: [
        {
          name: 'Plan',
          mode: 'plan',
          model: null,
          reasoning_effort: 'medium',
        },
        {
          name: 'Default',
          mode: 'default',
          model: null,
          reasoning_effort: null,
        },
      ],
    });
  });

  it('deletes AppServer threads from thread/read, thread/list, and loaded-list results', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Deleted AppServer RPC thread', cwd: process.cwd() });
    const deletedNotification = readEventStreamContains(
      startedThread.thread.id,
      0,
      '"method":"thread/deleted"',
      { format: 'swe' },
    );
    await sleep(25);

    await expect(appServerRpc('thread/delete', { threadId: startedThread.thread.id })).resolves.toEqual({});
    await expect(deletedNotification).resolves.toBe(true);

    await expect(appServerRpcEnvelope({
      id: 'read_deleted',
      method: 'thread/read',
      params: { threadId: startedThread.thread.id },
    })).resolves.toMatchObject({
      id: 'read_deleted',
      error: { code: -32004, message: 'Thread not found' },
    });
    const listed = await appServerRpc('thread/list', {});
    expect(listed.data.some((thread: { id: string }) => thread.id === startedThread.thread.id)).toBe(false);
    const loaded = await appServerRpc('thread/loaded/list', {});
    expect(loaded.data).not.toContain(startedThread.thread.id);
  });

  it('injects AppServer response items as hidden model-visible history', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Injected AppServer RPC thread', cwd: process.cwd() });

    await expect(appServerRpc('thread/inject_items', {
      threadId: startedThread.thread.id,
      items: [
        {
          id: 'injected_boundary',
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Side conversation boundary.' }],
        },
        {
          id: 'injected_assistant',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Injected assistant context.' }],
        },
        {
          id: 'injected_call',
          type: 'function_call',
          call_id: 'call_injected',
          name: 'workspace_search_text',
          arguments: '{"query":"needle"}',
        },
        {
          id: 'injected_output',
          type: 'function_call_output',
          call_id: 'call_injected',
          output: 'hidden search result',
        },
      ],
    })).resolves.toEqual({});

    const thread = (await runtimeFetch(`/v1/threads/${encodeURIComponent(startedThread.thread.id)}`)) as RuntimeThread;
    expect(thread.messageCount).toBe(0);
    expect(thread.lastMessagePreview).toBe('');
    expect(thread.messages).toEqual([
      expect.objectContaining({ id: 'injected_boundary', role: 'user', content: 'Side conversation boundary.', visibility: 'model' }),
      expect.objectContaining({ id: 'injected_assistant', role: 'assistant', content: 'Injected assistant context.', visibility: 'model' }),
      expect.objectContaining({
        id: 'injected_call',
        role: 'assistant',
        visibility: 'model',
        toolCalls: [{ id: 'call_injected', name: 'workspace_search_text', arguments: '{"query":"needle"}' }],
      }),
      expect.objectContaining({ id: 'injected_output', role: 'tool', toolCallId: 'call_injected', content: 'hidden search result', visibility: 'model' }),
    ]);

    const read = await appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
    expect(read.thread.turns).toEqual([]);

    await expect(appServerRpcEnvelope({
      id: 'inject_bad_item',
      method: 'thread/inject_items',
      params: {
        threadId: startedThread.thread.id,
        items: [{ type: 'reasoning', summary: [] }],
      },
    })).resolves.toMatchObject({
      id: 'inject_bad_item',
      error: { code: -32602, message: expect.stringContaining('not a supported response item') },
    });
  });

  it('sets, reads, updates, and clears AppServer thread goals', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Goal AppServer RPC thread', cwd: process.cwd() });
    const updatedNotification = readEventStreamContains(
      startedThread.thread.id,
      0,
      '"method":"thread/goal/updated"',
      { format: 'swe' },
    );
    await sleep(25);

    const set = await appServerRpc('thread/goal/set', {
      threadId: startedThread.thread.id,
      objective: 'Ship AppServer alignment.',
      status: 'active',
      tokenBudget: 1000,
    });
    await expect(updatedNotification).resolves.toBe(true);
    expect(set.goal).toMatchObject({
      threadId: startedThread.thread.id,
      objective: 'Ship AppServer alignment.',
      status: 'active',
      tokenBudget: 1000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
    });

    await expect(appServerRpc('thread/goal/get', { threadId: startedThread.thread.id })).resolves.toEqual({
      goal: set.goal,
    });

    const edited = await appServerRpc('thread/goal/set', {
      threadId: startedThread.thread.id,
      status: 'paused',
    });
    expect(edited.goal).toMatchObject({
      threadId: startedThread.thread.id,
      objective: 'Ship AppServer alignment.',
      status: 'paused',
      tokenBudget: 1000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: set.goal.createdAt,
    });

    const clearedNotification = readEventStreamContains(
      startedThread.thread.id,
      0,
      '"method":"thread/goal/cleared"',
      { format: 'swe' },
    );
    await sleep(25);
    await expect(appServerRpc('thread/goal/clear', { threadId: startedThread.thread.id })).resolves.toEqual({ cleared: true });
    await expect(clearedNotification).resolves.toBe(true);
    await expect(appServerRpc('thread/goal/get', { threadId: startedThread.thread.id })).resolves.toEqual({ goal: null });
    await expect(appServerRpc('thread/goal/clear', { threadId: startedThread.thread.id })).resolves.toEqual({ cleared: false });
  });

  it('returns AppServer goal validation errors for invalid thread goal requests', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Invalid goal AppServer RPC thread', cwd: process.cwd() });

    await expect(appServerRpcEnvelope({
      id: 'goal_missing_objective',
      method: 'thread/goal/set',
      params: { threadId: startedThread.thread.id, status: 'active' },
    })).resolves.toMatchObject({
      id: 'goal_missing_objective',
      error: { code: -32602, message: expect.stringContaining('no goal exists') },
    });

    await expect(appServerRpcEnvelope({
      id: 'goal_bad_budget',
      method: 'thread/goal/set',
      params: { threadId: startedThread.thread.id, objective: 'Ship it', tokenBudget: 0 },
    })).resolves.toMatchObject({
      id: 'goal_bad_budget',
      error: { code: -32602, message: 'goal budgets must be positive when provided' },
    });

    await expect(appServerRpcEnvelope({
      id: 'goal_bad_status',
      method: 'thread/goal/set',
      params: { threadId: startedThread.thread.id, objective: 'Ship it', status: 'unknown' },
    })).resolves.toMatchObject({
      id: 'goal_bad_status',
      error: { code: -32602, message: 'Unsupported goal status: unknown' },
    });
  });

  it('patches AppServer thread git metadata and returns updated thread shapes', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Metadata AppServer RPC thread', cwd: process.cwd() });

    const updated = await appServerRpc('thread/metadata/update', {
      threadId: startedThread.thread.id,
      gitInfo: {
        branch: 'feature/sidebar-pr',
      },
    });
    expect(updated.thread).toMatchObject({
      id: startedThread.thread.id,
      sessionId: startedThread.thread.sessionId,
      gitInfo: {
        sha: null,
        branch: 'feature/sidebar-pr',
        originUrl: null,
      },
      status: { type: 'idle' },
    });

    const read = await appServerRpc('thread/read', { threadId: startedThread.thread.id });
    expect(read.thread.gitInfo).toEqual({
      sha: null,
      branch: 'feature/sidebar-pr',
      originUrl: null,
    });
    const listed = await appServerRpc('thread/list', {});
    expect(listed.data.find((thread: { id: string }) => thread.id === startedThread.thread.id)).toMatchObject({
      gitInfo: {
        sha: null,
        branch: 'feature/sidebar-pr',
        originUrl: null,
      },
    });

    const cleared = await appServerRpc('thread/metadata/update', {
      threadId: startedThread.thread.id,
      gitInfo: {
        branch: null,
      },
    });
    expect(cleared.thread.gitInfo).toBeNull();
    await expect(appServerRpc('thread/read', { threadId: startedThread.thread.id })).resolves.toMatchObject({
      thread: { gitInfo: null },
    });
  });

  it('returns AppServer metadata validation errors for invalid gitInfo patches', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Invalid metadata AppServer RPC thread', cwd: process.cwd() });

    await expect(appServerRpcEnvelope({
      id: 'metadata_missing_git_info',
      method: 'thread/metadata/update',
      params: { threadId: startedThread.thread.id },
    })).resolves.toMatchObject({
      id: 'metadata_missing_git_info',
      error: { code: -32602, message: 'gitInfo must include at least one field' },
    });

    await expect(appServerRpcEnvelope({
      id: 'metadata_empty_git_info',
      method: 'thread/metadata/update',
      params: { threadId: startedThread.thread.id, gitInfo: {} },
    })).resolves.toMatchObject({
      id: 'metadata_empty_git_info',
      error: { code: -32602, message: 'gitInfo must include at least one field' },
    });

    await expect(appServerRpcEnvelope({
      id: 'metadata_empty_branch',
      method: 'thread/metadata/update',
      params: { threadId: startedThread.thread.id, gitInfo: { branch: '   ' } },
    })).resolves.toMatchObject({
      id: 'metadata_empty_branch',
      error: { code: -32602, message: 'gitInfo.branch must not be empty' },
    });
  });

  it('rolls back trailing AppServer turns and returns populated thread history', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Rollback AppServer RPC thread', cwd: process.cwd() });
    const firstTurn = await appServerRpc('turn/start', {
      threadId: startedThread.thread.id,
      input: [{ type: 'text', text: 'First local smoke response.' }],
    });
    await waitForThread(
      startedThread.thread.id,
      (item) => item.messages.some((message) => message.turnId === firstTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
    );
    const secondTurn = await appServerRpc('turn/start', {
      threadId: startedThread.thread.id,
      input: [{ type: 'text', text: 'Second local smoke response.' }],
    });
    await waitForThread(
      startedThread.thread.id,
      (item) => item.messages.some((message) => message.turnId === secondTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
    );

    const rolledBack = await appServerRpc('thread/rollback', {
      threadId: startedThread.thread.id,
      numTurns: 1,
    });

    expect(rolledBack.thread.turns).toEqual([expect.objectContaining({
      id: firstTurn.turn.id,
      items: expect.arrayContaining([
        expect.objectContaining({ type: 'userMessage' }),
        expect.objectContaining({ type: 'agentMessage' }),
      ]),
    })]);
    expect(rolledBack.thread.turns.some((turn: { id: string }) => turn.id === secondTurn.turn.id)).toBe(false);

    const resumed = await appServerRpc('thread/resume', { threadId: startedThread.thread.id });
    expect(resumed.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([firstTurn.turn.id]);
  });

  it('returns JSON-RPC method errors from the AppServer app-server adapter', async () => {
    const response = await appServerRpcEnvelope({ id: 99, method: 'missing/method', params: {} });
    expect(response).toEqual({
      id: 99,
      error: {
        code: -32601,
        message: 'Method not found: missing/method',
      },
    });
  });

  it('runs buffered AppServer command/exec requests without creating thread output', async () => {
    const response = await appServerRpc('command/exec', {
      command: [
        process.execPath,
        '-e',
        'process.stdout.write("exec-out"); process.stderr.write("exec-err");',
      ],
      timeoutMs: 5_000,
    });

    expect(response).toEqual({
      exitCode: 0,
      stdout: 'exec-out',
      stderr: 'exec-err',
    });
  });

  it('merges AppServer command/exec environment overrides and supports unset values', async () => {
    const response = await appServerRpc('command/exec', {
      command: [
        process.execPath,
        '-e',
        'process.stdout.write(`${process.env.APP_SERVER_EXEC_BASELINE}|${process.env.APP_SERVER_EXEC_EXTRA}|${process.env.APP_SERVER_EXEC_UNSET ?? "unset"}`);',
      ],
      env: {
        APP_SERVER_EXEC_BASELINE: 'request',
        APP_SERVER_EXEC_EXTRA: 'added',
        APP_SERVER_EXEC_UNSET: null,
      },
      timeoutMs: 5_000,
    });

    expect(response).toEqual({
      exitCode: 0,
      stdout: 'request|added|unset',
      stderr: '',
    });
  });

  it('supports AppServer command/exec stdin writes for client process ids', async () => {
    const processId = `proc-${Date.now()}`;
    const execPromise = appServerRpc('command/exec', {
      command: [
        process.execPath,
        '-e',
        'let data = ""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(`stdin:${data}`));',
      ],
      processId,
      streamStdin: true,
      timeoutMs: 5_000,
    });
    await sleep(25);

    await expect(appServerRpc('command/exec/write', {
      processId,
      deltaBase64: Buffer.from('hello').toString('base64'),
      closeStdin: true,
    })).resolves.toEqual({});

    await expect(execPromise).resolves.toEqual({
      exitCode: 0,
      stdout: 'stdin:hello',
      stderr: '',
    });
  });

  it('rejects unsupported AppServer command/exec streaming output on the HTTP adapter', async () => {
    await expect(appServerRpcEnvelope({
      id: 'streaming_exec',
      method: 'command/exec',
      params: {
        command: [process.execPath, '-e', 'process.stdout.write("stream")'],
        processId: 'streaming-process',
        streamStdoutStderr: true,
      },
    })).resolves.toMatchObject({
      id: 'streaming_exec',
      error: {
        code: -32600,
        message: expect.stringContaining('server notifications'),
      },
    });
  });

  it('returns the upstream empty response shape for AppServer turn interrupts', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Interrupt shape', cwd: process.cwd() });
    const startedTurn = await appServerRpc('turn/start', {
      threadId: startedThread.thread.id,
      input: [{ type: 'text', text: 'Start a cancellable local response.' }],
    });

    await expect(appServerRpc('turn/interrupt', {
      threadId: startedThread.thread.id,
      turnId: startedTurn.turn.id,
    })).resolves.toEqual({});
  });

  it('returns JSON-RPC invalid request errors from the AppServer app-server adapter', async () => {
    const response = await appServerRpcEnvelope(null);
    expect(response).toEqual({
      id: null,
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
    });
  });

  it('accepts AppServer JSON-RPC approval response envelopes on the app-server adapter', async () => {
    const response = await appServerRpcEnvelope({
      id: 'approval_missing',
      result: { decision: 'accept' },
    });

    expect(response).toEqual({
      id: 'approval_missing',
      error: {
        code: -32603,
        message: 'Approval not found: approval_missing',
      },
    });
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

  it('exposes AppServer-style SWE notifications from the event stream when requested', async () => {
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'AppServer SWE events' }),
    });
    const started = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: 'Write a local smoke response.' }),
    });

    const hasAppServerStarted = await readEventStreamContains(
      thread.id,
      0,
      '"method":"turn/started"',
      { format: 'swe' },
    );
    const hasThreadStatus = await readEventStreamContains(
      thread.id,
      0,
      '"method":"thread/status/changed"',
      { format: 'swe' },
    );

    expect(started).toMatchObject({ accepted: true });
    expect(hasAppServerStarted).toBe(true);
    expect(hasThreadStatus).toBe(true);
  });

  it('streams AppServer-style context compaction lifecycle notifications', async () => {
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'AppServer SWE context compaction' }),
    });
    const oversizedHistory = 'older context '.repeat(90_000);
    const initialTurn = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: oversizedHistory }),
    });
    await expect(readRuntimeEvent(thread.id, 0, 'turn.completed', { timeoutMs: 10_000 })).resolves.toBe(true);
    const beforeCompaction = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`) as RuntimeThread;
    const compactingTurn = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: 'Continue after compaction.' }),
    });

    await expect(readRuntimeEvent(thread.id, beforeCompaction.lastSeq, 'thread.context_compacted', { timeoutMs: 15_000 })).resolves.toBe(true);
    const compacted = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`) as RuntimeThread;
    const hasContextCompactionItem = await readEventStreamContains(
      thread.id,
      0,
      '"type":"contextCompaction"',
      { format: 'swe' },
    );
    const hasThreadCompacted = await readEventStreamContains(
      thread.id,
      0,
      '"method":"thread/compacted"',
      { format: 'swe' },
    );
    const read = await appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });
    const forkedThroughInitialTurn = await appServerRpc('thread/fork', {
      threadId: thread.id,
      lastTurnId: initialTurn.turnId,
      name: 'Forked before compaction',
    });

    expect(compacted.messages[0]?.content).toContain('<context_compaction_summary');
    expect(read.thread.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'contextCompaction' }),
        ]),
      }),
    ]));
    expect(JSON.stringify(read.thread.turns)).toContain(compactingTurn.turnId);
    expect(JSON.stringify(forkedThroughInitialTurn.thread.turns)).not.toContain('contextCompaction');
    expect(JSON.stringify(forkedThroughInitialTurn.thread.turns)).not.toContain(compactingTurn.turnId);
    expect(hasContextCompactionItem).toBe(true);
    expect(hasThreadCompacted).toBe(true);
  }, 20_000);

  it('streams manual AppServer compact requests as contextCompaction turns', async () => {
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Manual AppServer compact' }),
    });
    await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: 'Create enough history for manual compact.' }),
    });
    await waitForThread(
      thread.id,
      (item) => item.messages.some((message) => message.role === 'assistant' && message.status === 'complete'),
    );

    await expect(appServerRpc('thread/compact/start', { threadId: thread.id })).resolves.toEqual({});

    const compacted = await waitForThread(
      thread.id,
      (item) => item.messages[0]?.contextCompaction?.triggerScopes?.includes('manual') === true,
    );
    const hasContextCompactionItem = await readEventStreamContains(
      thread.id,
      0,
      '"type":"contextCompaction"',
      { format: 'swe' },
    );
    const read = await appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });

    expect(compacted.messages[0]?.turnId).toBeTruthy();
    expect(read.thread.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: compacted.messages[0]?.turnId,
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'contextCompaction' }),
        ]),
      }),
    ]));
    expect(hasContextCompactionItem).toBe(true);
  }, 10_000);

  it('runs AppServer thread shell commands as userShell commandExecution events', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-swe-shell-project-'));
    const project = await runtimeFetch('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ path: projectDir, name: 'AppServer shell project' }),
    });
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'AppServer shell command', projectId: project.id }),
    });

    await expect(appServerRpc('thread/shellCommand', {
      threadId: thread.id,
      command: `${nodeCommand()} -e "process.stdout.write('swe shell output\\n')"`,
    })).resolves.toEqual({});

    const hasUserShellItem = await readEventStreamContains(
      thread.id,
      0,
      '"source":"userShell"',
      { format: 'swe' },
    );
    const hasOutputDelta = await readEventStreamContains(
      thread.id,
      0,
      '"method":"item/commandExecution/outputDelta"',
      { format: 'swe' },
    );
    const hasRuntimeOutputDelta = await readEventStreamContains(
      thread.id,
      0,
      '"type":"tool.output_delta"',
    );
    const read = await appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });

    expect(hasUserShellItem).toBe(true);
    expect(hasOutputDelta).toBe(true);
    expect(hasRuntimeOutputDelta).toBe(true);
    expect(read.thread.turns).toEqual([expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          type: 'commandExecution',
          source: 'userShell',
          aggregatedOutput: expect.stringContaining('swe shell output'),
        }),
      ]),
    })]);
  });

  it('attaches AppServer thread shell commands to an active turn', async () => {
    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'delayed-provider',
          providers: [
            {
              id: 'delayed-provider',
              name: 'Delayed provider',
              provider: 'openai-compatible',
              baseUrl: capture.baseUrl,
              apiKey: 'sk-delayed',
              enabled: true,
              models: [
                {
                  id: 'delayed-model',
                  name: 'Delayed model',
                  code: 'delayed-model',
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
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-swe-active-shell-project-'));
      const project = await runtimeFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ path: projectDir, name: 'Active shell project' }),
      });
      const thread = await runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Active shell command', projectId: project.id }),
      });
      const started = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ input: 'Keep this turn active.' }),
      });
      await withTimeout(capture.nextBody, 1500, 'Timed out waiting for delayed provider request');

      await expect(appServerRpc('thread/shellCommand', {
        threadId: thread.id,
        command: `${nodeCommand()} -e "process.stdout.write('active shell output\\n')"`,
      })).resolves.toEqual({});

      const updated = await waitForThread(
        thread.id,
        (item) => item.messages.some((message) =>
          message.turnId === started.turnId
          && message.role === 'tool'
          && message.toolName === 'run_shell_command'
          && message.content.includes('active shell output')
        ),
      );
      const hasUserShellItem = await readEventStreamContains(
        thread.id,
        0,
        '"source":"userShell"',
        { format: 'swe' },
      );
      const read = await appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });
      const activeTurn = read.thread.turns.find((turn: { id: string }) => turn.id === started.turnId);

      expect(hasUserShellItem).toBe(true);
      expect(updated.messages.filter((message) => message.turnId === started.turnId && message.role === 'tool')).toHaveLength(1);
      expect(activeTurn?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'commandExecution',
          source: 'userShell',
          aggregatedOutput: expect.stringContaining('active shell output'),
        }),
      ]));
    } finally {
      capture.release();
      await capture.close();
    }
  });

  it('steers additional AppServer user input into the active turn', async () => {
    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'steer-provider',
          providers: [
            {
              id: 'steer-provider',
              name: 'Steer provider',
              provider: 'openai-compatible',
              baseUrl: capture.baseUrl,
              apiKey: 'sk-steer',
              enabled: true,
              models: [
                {
                  id: 'steer-model',
                  name: 'Steer model',
                  code: 'steer-model',
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
      const startedThread = await appServerRpc('thread/start', { name: 'Steer active AppServer turn', cwd: process.cwd() });
      const startedTurn = await appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        clientUserMessageId: 'client-start-message-1',
        input: [{ type: 'text', text: 'Keep this turn active.' }],
      });
      await withTimeout(capture.nextBody, 1500, 'Timed out waiting for delayed provider request');

      await expect(appServerRpc('turn/steer', {
        threadId: startedThread.thread.id,
        expectedTurnId: startedTurn.turn.id,
        clientUserMessageId: 'client-steer-message-1',
        input: [{ type: 'text', text: 'Steer this active turn.' }],
      })).resolves.toEqual({ turnId: startedTurn.turn.id });

      const updated = await waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) =>
          message.turnId === startedTurn.turn.id
          && message.role === 'user'
          && message.content === 'Steer this active turn.'
        ),
      );
      const hasSteeredItem = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"clientId":"client-steer-message-1"',
        { format: 'swe' },
      );
      const read = await appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
      const activeTurn = read.thread.turns.find((turn: { id: string }) => turn.id === startedTurn.turn.id);

      expect(hasSteeredItem).toBe(true);
      expect(updated.messages.filter((message) => message.turnId === startedTurn.turn.id && message.role === 'user')).toHaveLength(2);
      expect(activeTurn?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'userMessage',
          clientId: 'client-start-message-1',
          content: [{ type: 'text', text: 'Keep this turn active.' }],
        }),
        expect.objectContaining({
          type: 'userMessage',
          clientId: 'client-steer-message-1',
          content: [{ type: 'text', text: 'Steer this active turn.' }],
        }),
      ]));
    } finally {
      capture.release();
      await capture.close();
    }
  });

  it('rejects AppServer turn steering without a matching active turn', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'No active steer', cwd: process.cwd() });

    await expect(appServerRpcEnvelope({
      id: 'steer_without_active_turn',
      method: 'turn/steer',
      params: {
        threadId: startedThread.thread.id,
        expectedTurnId: 'turn-does-not-exist',
        input: [{ type: 'text', text: 'No active turn.' }],
      },
    })).resolves.toMatchObject({
      id: 'steer_without_active_turn',
      error: { code: -32600, message: 'no active turn to steer' },
    });
  });

  it('starts inline AppServer reviews with visible review mode markers', async () => {
    const capture = await createOpenAiCaptureServer();
    try {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'review-provider',
          providers: [
            {
              id: 'review-provider',
              name: 'Review provider',
              provider: 'openai-compatible',
              baseUrl: capture.baseUrl,
              apiKey: 'sk-review',
              enabled: true,
              models: [
                {
                  id: 'review-model',
                  name: 'Review model',
                  code: 'review-model',
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
      const startedThread = await appServerRpc('thread/start', { name: 'Inline review', cwd: process.cwd() });
      const review = await appServerRpc('review/start', {
        threadId: startedThread.thread.id,
        delivery: 'inline',
        target: { type: 'commit', sha: '1234567890abcdef', title: 'Tidy UI colors' },
      });
      const body = await withTimeout(capture.nextBody, 1500, 'Timed out waiting for review provider request');

      expect(JSON.stringify(body)).toContain('Review commit 1234567890abcdef: Tidy UI colors.');
      expect(review).toMatchObject({
        reviewThreadId: startedThread.thread.id,
        turn: {
          status: 'inProgress',
          itemsView: 'notLoaded',
          items: [
            {
              type: 'userMessage',
              clientId: null,
              content: [{ type: 'text', text: 'commit 1234567: Tidy UI colors' }],
            },
          ],
        },
      });

      const turnId = review.turn.id as string;
      const updated = await waitForThread(
        startedThread.thread.id,
        (item) =>
          item.messages.some((message) => message.turnId === turnId && message.reviewMode?.kind === 'entered')
          && item.messages.some((message) => message.turnId === turnId && message.role === 'assistant' && message.content === 'Captured.')
          && item.messages.some((message) => message.turnId === turnId && message.reviewMode?.kind === 'exited' && message.reviewMode.review === 'Captured.'),
      );
      const reviewMessages = updated.messages.filter((message) => message.turnId === turnId && message.reviewMode);
      const hasEnteredReviewItem = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"type":"enteredReviewMode"',
        { format: 'swe' },
      );
      const hasExitedReviewItem = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"type":"exitedReviewMode"',
        { format: 'swe' },
      );
      const read = await appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
      const activeTurn = read.thread.turns.find((turn: { id: string }) => turn.id === turnId);

      expect(review.turn.items[0].id).toBe(turnId);
      expect(reviewMessages.map((message) => message.reviewMode?.kind)).toEqual(['entered', 'exited']);
      expect(hasEnteredReviewItem).toBe(true);
      expect(hasExitedReviewItem).toBe(true);
      expect(activeTurn?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'enteredReviewMode', id: turnId, review: 'commit 1234567: Tidy UI colors' }),
        expect.objectContaining({ type: 'agentMessage', text: 'Captured.' }),
        expect.objectContaining({ type: 'exitedReviewMode', id: turnId, review: 'Captured.' }),
      ]));
    } finally {
      await capture.close();
    }
  });

  it('rejects detached AppServer reviews until a visible thread route exists', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Detached review', cwd: process.cwd() });

    await expect(appServerRpcEnvelope({
      id: 'detached_review',
      method: 'review/start',
      params: {
        threadId: startedThread.thread.id,
        delivery: 'detached',
        target: { type: 'custom', instructions: 'Review elsewhere.' },
      },
    })).resolves.toMatchObject({
      id: 'detached_review',
      error: { code: -32600, message: 'review/start detached delivery is not supported yet' },
    });
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

  it('clears all local memories', async () => {
    await runtimeFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'Use local memory only.', scope: 'global' }),
    });
    await runtimeFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'Project rule.', scope: 'global' }),
    });

    await expect(runtimeFetch('/v1/memories', { method: 'DELETE' })).resolves.toMatchObject({ memories: [] });
    await expect(runtimeFetch('/v1/memories')).resolves.toMatchObject({ memories: [] });
  });

  it('previews local memories from the configured storage path', async () => {
    const storagePath = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-memory-preview-test-'));
    const config = await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({ storagePath }),
    });
    const created = await runtimeFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'Preview this configured memory.', scope: 'global' }),
    });
    const preview = await runtimeFetch('/v1/memories/preview');

    expect(config.storagePath).toBe(storagePath);
    expect(preview.storagePath).toBe(path.resolve(storagePath));
    expect(preview).toMatchObject({
      total: 1,
      items: [{ id: created.memories[0].id, preview: 'Preview this configured memory.' }],
    });

    await runtimeFetch(`/v1/memories/${encodeURIComponent(created.memories[0].id)}`, { method: 'DELETE' });
    await expect(runtimeFetch('/v1/memories/preview')).resolves.toMatchObject({ total: 0, items: [] });
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

    await expect(appServerRpc('mcpServerStatus/list', {})).resolves.toEqual({
      data: [
        {
          name: 'docs',
          serverInfo: null,
          tools: {},
          resources: [],
          resourceTemplates: [],
          authStatus: 'unsupported',
        },
      ],
      nextCursor: null,
    });
    await expect(appServerRpc('mcpServerStatus/list', { limit: 1 })).resolves.toMatchObject({
      data: [{ name: 'docs' }],
      nextCursor: null,
    });
    await expect(appServerRpcEnvelope({
      id: 'bad_mcp_cursor',
      method: 'mcpServerStatus/list',
      params: { cursor: 'invalid' },
    })).resolves.toMatchObject({
      id: 'bad_mcp_cursor',
      error: { code: -32600, message: 'invalid cursor: invalid' },
    });

    await runtimeFetch('/v1/mcp/servers/docs', { method: 'DELETE' });
    await expect(runtimeFetch('/v1/mcp/servers')).resolves.toMatchObject({ servers: [] });
    await expect(appServerRpc('mcpServerStatus/list', {})).resolves.toEqual({ data: [], nextCursor: null });
  });

  async function startRuntimeServer(dataDir: string): Promise<void> {
    server = await createRuntimeServer({ dataDir, token, version: 'test' });
    await server.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function seedStaleRuntimeThread(dataDir: string): Promise<string> {
    const now = '2026-06-26T00:00:00.000Z';
    const thread: RuntimeThread = {
      id: 'thread_stale',
      title: 'Stale thread',
      createdAt: now,
      updatedAt: now,
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_stale',
          role: 'assistant',
          turnId: 'turn_stale',
          content: '',
          createdAt: now,
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_stale',
              name: 'read_file',
              status: 'running',
            },
          ],
        },
      ],
    };
    const threadsDir = path.join(dataDir, 'runtime', 'threads');
    await mkdir(threadsDir, { recursive: true });
    await writeFile(
      path.join(threadsDir, 'index.json'),
      JSON.stringify({
        threads: [
          {
            id: thread.id,
            title: thread.title,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            archived: thread.archived,
            messageCount: thread.messageCount,
            lastMessagePreview: thread.lastMessagePreview,
          },
        ],
      }),
    );
    await writeFile(path.join(threadsDir, `${thread.id}.json`), JSON.stringify(thread));
    return thread.id;
  }

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

  async function appServerRpc(method: string, params: Record<string, unknown>) {
    const response = await appServerRpcEnvelope({ id: method, method, params });
    if ('error' in response) throw new Error(response.error.message);
    return response.result as Record<string, any>;
  }

  async function appServerRpcEnvelope(body: unknown) {
    return runtimeFetch('/v1/swe/app-server', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<{ id: unknown; result: any } | { id: unknown; error: { code: number; message: string; data?: unknown } }>;
  }

  async function waitForThread(
    threadId: string,
    predicate: (thread: RuntimeThread) => boolean,
    timeoutMs = 6000,
  ): Promise<RuntimeThread> {
    const deadline = Date.now() + timeoutMs;
    let lastThread: RuntimeThread | undefined;
    while (Date.now() < deadline) {
      const currentThread = (await runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
      lastThread = currentThread;
      if (predicate(currentThread)) return currentThread;
      await sleep(25);
    }
    throw new Error(`Timed out waiting for thread state: ${JSON.stringify(lastThread)}`);
  }

  async function readRuntimeEvent(
    threadId: string,
    sinceSeq: number,
    type: string,
    options: { timeoutMs?: number } = {},
  ): Promise<boolean> {
    return readEventStreamContains(threadId, sinceSeq, `"type":"${type}"`, options);
  }

  async function readEventStreamContains(
    threadId: string,
    sinceSeq: number,
    needle: string,
    options: { format?: string; timeoutMs?: number } = {},
  ): Promise<boolean> {
    const controller = new AbortController();
    const params = new URLSearchParams({ sinceSeq: String(sinceSeq) });
    if (options.format) params.set('format', options.format);
    const response = await fetch(`${baseUrl}/v1/threads/${encodeURIComponent(threadId)}/events?${params}`, {
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
    const deadline = Date.now() + (options.timeoutMs ?? 1500);
    try {
      while (Date.now() < deadline) {
        const result = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => null)]);
        if (!result) break;
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        if (buffer.includes(needle)) return true;
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

async function createDelayedOpenAiCaptureServer(): Promise<{
  baseUrl: string;
  nextBody: Promise<Record<string, unknown>>;
  release(): void;
  close(): Promise<void>;
}> {
  let resolveBody: (body: Record<string, unknown>) => void = () => undefined;
  let rejectBody: (error: unknown) => void = () => undefined;
  let releaseResponse: () => void = () => undefined;
  const nextBody = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveBody = resolve;
    rejectBody = reject;
  });
  const released = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      resolveBody(JSON.parse(await readRequestText(request)) as Record<string, unknown>);
      await released;
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Released.' } }] })}\n\n`);
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
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for delayed capture server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    nextBody,
    release: releaseResponse,
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

function nodeCommand(): string {
  return JSON.stringify(process.execPath);
}
