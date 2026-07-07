import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appServerCommandSandboxProfile } from './app-server/command-exec.js';
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

  it('updates thread memory mode through the runtime API', async () => {
    const created = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Memory mode' }),
    });

    expect(created).toMatchObject({ title: 'Memory mode', memoryMode: 'enabled' });

    const updated = await runtimeFetch(`/v1/threads/${encodeURIComponent(created.id)}/memory-mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'enabled' }),
    });
    const list = await runtimeFetch('/v1/threads');

    expect(updated).toMatchObject({ id: created.id, memoryMode: 'enabled' });
    expect(list.threads).toMatchObject([{ id: created.id, memoryMode: 'enabled' }]);
  });

  it('updates thread memory mode through the AppServer RPC', async () => {
    const started = await appServerRpc('thread/start', { name: 'AppServer memory mode', cwd: process.cwd() });

    await expect(appServerRpc('thread/memoryMode/set', {
      threadId: started.thread.id,
      mode: 'disabled',
    })).resolves.toEqual({});

    await expect(runtimeFetch(`/v1/threads/${encodeURIComponent(started.thread.id)}`)).resolves.toMatchObject({
      id: started.thread.id,
      memoryMode: 'disabled',
    });

    await expect(appServerRpc('thread/memoryMode/set', {
      thread_id: started.thread.id,
      mode: 'enabled',
    })).resolves.toEqual({});

    await expect(runtimeFetch(`/v1/threads/${encodeURIComponent(started.thread.id)}`)).resolves.toMatchObject({
      id: started.thread.id,
      memoryMode: 'enabled',
    });

    await expect(appServerRpcEnvelope({
      id: 'invalid_memory_mode',
      method: 'thread/memoryMode/set',
      params: { threadId: started.thread.id, mode: 'polluted' },
    })).resolves.toMatchObject({
      id: 'invalid_memory_mode',
      error: { code: -32602, message: 'mode must be enabled or disabled' },
    });
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

  it('generates git commit messages through the active model', async () => {
    const modelServer = await createOpenAiCaptureServer('feat: update git controls');
    try {
      await configureOpenAiProvider('commit-message', modelServer.baseUrl);

      const result = await runtimeFetch('/v1/git/commit-message/generate', {
        method: 'POST',
        body: JSON.stringify({
          branch: 'master',
          status: ' M src/chat.ts',
          diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
        }),
      });
      const requestBody = await modelServer.nextBody;

      expect(JSON.stringify(requestBody)).toContain('src/chat.ts');
      expect(result).toEqual({ message: 'feat: update git controls' });
    } finally {
      await modelServer.close();
    }
  });

  it('falls back to a deterministic commit message when the active model returns no text', async () => {
    const modelServer = await createOpenAiCaptureServer('');
    try {
      await configureOpenAiProvider('empty-commit-message', modelServer.baseUrl);

      const result = await runtimeFetch('/v1/git/commit-message/generate', {
        method: 'POST',
        body: JSON.stringify({
          branch: 'master',
          status: ' M src/chat.ts',
          diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
        }),
      });

      expect(result).toEqual({ message: 'chore: update src/chat.ts' });
    } finally {
      await modelServer.close();
    }
  });

  it('falls back when the active model returns only invisible commit text', async () => {
    const modelServer = await createOpenAiCaptureServer('\u200B\u2060');
    try {
      await configureOpenAiProvider('invisible-commit-message', modelServer.baseUrl);

      const result = await runtimeFetch('/v1/git/commit-message/generate', {
        method: 'POST',
        body: JSON.stringify({
          branch: 'master',
          status: ' M src/chat.ts',
          diff: 'diff --git a/src/chat.ts b/src/chat.ts\n+const changed = true;\n',
        }),
      });

      expect(result).toEqual({ message: 'chore: update src/chat.ts' });
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

  it('supports AppServer skills list, extra roots, and config writes', async () => {
    const stream = await openAppServerNotificationStream();
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-skills-project-'));
    const extraRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-skills-extra-'));
    const extraSkillDir = path.join(extraRoot, 'appserver-extra');
    const extraSkillPath = path.join(extraSkillDir, 'SKILL.md');
    await mkdir(extraSkillDir, { recursive: true });
    await writeFile(
      extraSkillPath,
      [
        '---',
        'name: AppServer Extra',
        'description: Loaded through skills/extraRoots/set',
        '---',
        '',
        '# AppServer Extra',
        '',
        'Use the AppServer extra root.',
      ].join('\n'),
    );

    try {
      const initial = await appServerRpc('skills/list', { cwds: [projectDir], forceReload: true });
      expect(initial).toMatchObject({
        data: [{
          cwd: projectDir,
          errors: [],
          skills: expect.arrayContaining([
            expect.objectContaining({
              name: 'presentation-mcp',
              scope: 'system',
              enabled: true,
              path: expect.stringContaining(path.join('presentation-mcp', 'SKILL.md')),
            }),
          ]),
        }],
      });

      await expect(appServerRpc('skills/extraRoots/set', { extraRoots: [extraRoot] })).resolves.toEqual({});
      await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: 1000 }))
        .resolves.toMatchObject({ method: 'skills/changed', params: {} });

      const withExtraRoot = await appServerRpc('skills/list', { cwds: [projectDir] });
      expect(withExtraRoot.data[0].skills).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'AppServer Extra',
          description: 'Loaded through skills/extraRoots/set',
          scope: 'user',
          enabled: true,
          path: extraSkillPath,
        }),
      ]));

      await expect(appServerRpc('skills/config/write', {
        name: 'AppServer Extra',
        path: null,
        enabled: false,
      })).resolves.toEqual({ effectiveEnabled: false });
      await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: 1000 }))
        .resolves.toMatchObject({ method: 'skills/changed', params: {} });

      await expect(appServerRpc('skills/list', { cwds: [projectDir] })).resolves.toMatchObject({
        data: [{
          skills: expect.arrayContaining([
            expect.objectContaining({
              name: 'AppServer Extra',
              enabled: false,
            }),
          ]),
        }],
      });

      await expect(appServerRpc('skills/config/write', {
        path: extraSkillPath,
        name: null,
        enabled: true,
      })).resolves.toEqual({ effectiveEnabled: true });
      await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: 1000 }))
        .resolves.toMatchObject({ method: 'skills/changed', params: {} });

      await writeFile(
        extraSkillPath,
        [
          '---',
          'name: AppServer Extra',
          'description: Changed outside the AppServer RPC',
          '---',
          '',
          '# AppServer Extra',
          '',
          'Updated directly on disk.',
        ].join('\n'),
      );
      await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: 1500 }))
        .resolves.toMatchObject({ method: 'skills/changed', params: {} });
      await expect(appServerRpc('skills/list', { cwds: [projectDir] })).resolves.toMatchObject({
        data: [{
          skills: expect.arrayContaining([
            expect.objectContaining({
              name: 'AppServer Extra',
              description: 'Changed outside the AppServer RPC',
            }),
          ]),
        }],
      });

      await expect(appServerRpcEnvelope({
        id: 'missing_skill_config',
        method: 'skills/config/write',
        params: { name: 'missing-skill', enabled: true },
      })).resolves.toMatchObject({
        id: 'missing_skill_config',
        error: {
          code: -32600,
          message: 'No matching skill found',
        },
      });
    } finally {
      await stream.close();
    }
  });

  it('supports AppServer hooks list discovery shape', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-hooks-project-'));
    const readConfig = await appServerRpc('config/read', {});
    const configPath = readConfig.origins.hooks.name.file;

    await expect(appServerRpc('config/batchWrite', {
      edits: [{
        keyPath: 'hooks',
        mergeStrategy: 'replace',
        value: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{
              type: 'command',
              command: 'python3 /tmp/listed-hook.py',
              timeout: 5,
              statusMessage: 'running listed hook',
            }],
          }],
        },
      }],
    })).resolves.toMatchObject({ status: 'ok' });

    const listed = await appServerRpc('hooks/list', { cwds: [projectDir] });
    expect(listed).toMatchObject({
      data: [{
        cwd: projectDir,
        warnings: [],
        errors: [],
        hooks: [{
          key: `${configPath}:pre_tool_use:0:0`,
          eventName: 'preToolUse',
          handlerType: 'command',
          matcher: 'Bash',
          command: 'python3 /tmp/listed-hook.py',
          timeoutSec: 5,
          statusMessage: 'running listed hook',
          sourcePath: configPath,
          source: 'user',
          pluginId: null,
          displayOrder: 0,
          enabled: true,
          isManaged: false,
          currentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          trustStatus: 'untrusted',
        }],
      }],
    });
    const hook = listed.data[0].hooks[0];

    await expect(appServerRpc('config/batchWrite', {
      edits: [{
        keyPath: 'hooks',
        mergeStrategy: 'replace',
        value: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{
              type: 'command',
              command: 'python3 /tmp/listed-hook.py',
              timeout: 5,
              statusMessage: 'running listed hook',
            }],
          }],
          state: {
            [hook.key]: {
              enabled: true,
              trusted_hash: hook.currentHash,
            },
          },
        },
      }],
    })).resolves.toMatchObject({ status: 'ok' });

    await expect(appServerRpc('hooks/list', { cwds: [projectDir] })).resolves.toEqual({
      data: [{
        cwd: projectDir,
        hooks: [{
          ...hook,
          trustStatus: 'trusted',
        }],
        warnings: [],
        errors: [],
      }],
    });

    await expect(appServerRpc('config/batchWrite', {
      edits: [{
        keyPath: 'features.hooks',
        value: false,
      }],
    })).resolves.toMatchObject({ status: 'ok' });
    await expect(appServerRpc('hooks/list', { cwds: [] })).resolves.toEqual({
      data: [{
        cwd: process.cwd(),
        hooks: [],
        warnings: [],
        errors: [],
      }],
    });
    await expect(appServerRpcEnvelope({
      id: 'invalid_hooks_cwds',
      method: 'hooks/list',
      params: { cwds: projectDir },
    })).resolves.toMatchObject({
      id: 'invalid_hooks_cwds',
      error: {
        code: -32602,
        message: 'cwds must be an array',
      },
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

  it('settles persisted item-based active turns when the runtime starts', async () => {
    await server.close();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-stale-items-test-'));
    const threadId = await seedStaleRuntimeItemThread(dataDir);

    await startRuntimeServer(dataDir);

    const thread = (await runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
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
                contextWindowTokens: 128000,
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
      model_context_window: 128000,
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
      memories: {
        disable_on_external_context: false,
        generate_memories: false,
        use_memories: false,
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
    expect(response.origins['memories.use_memories']).toMatchObject({
      version: '1',
      name: { type: 'user' },
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
                contextWindowTokens: 64000,
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
        { keyPath: 'model_context_window', value: 32000, mergeStrategy: 'replace' },
        { keyPath: 'model_auto_compact_token_limit', value: 28000, mergeStrategy: 'replace' },
        { keyPath: 'desktop.selected-avatar-id', value: 'swe', mergeStrategy: 'replace' },
      ],
    })).resolves.toMatchObject({ status: 'ok', version: '1' });

    const read = await appServerRpc('config/read', {});
    expect(read.config).toMatchObject({
      model: 'gpt-beta',
      model_context_window: 32000,
      model_auto_compact_token_limit: 28000,
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
        memory_enabled: true,
      },
    });
  });

  it('writes AppServer memory settings without collapsing read and generate', async () => {
    await expect(appServerRpc('config/batchWrite', {
      edits: [
        {
          keyPath: 'memories',
          value: {
            disable_on_external_context: false,
            generate_memories: false,
            min_rate_limit_remaining_percent: 0,
            max_rollouts_per_startup: 3,
          },
          mergeStrategy: 'replace',
        },
        { keyPath: 'memories.use_memories', value: true, mergeStrategy: 'replace' },
      ],
    })).resolves.toMatchObject({ status: 'ok', version: '1' });

    const read = await appServerRpc('config/read', {});
    expect(read.config).toMatchObject({
      desktop: {
        memory_enabled: true,
      },
      features: {
        memories: false,
      },
      memories: {
        disable_on_external_context: false,
        generate_memories: false,
        use_memories: true,
        min_rate_limit_remaining_percent: 0,
        max_rollouts_per_startup: 3,
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
        enabled: false,
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

  it('applies AppServer Plan collaboration mode reasoning to turn starts', async () => {
    const capture = await createOpenAiCaptureServer();
    try {
      await configureOpenAiProvider('planmodeprovider', capture.baseUrl, {
        thinkingEnabled: true,
        thinkingEfforts: ['medium'],
        defaultThinkingEffort: 'medium',
      });
      const startedThread = await appServerRpc('thread/start', { name: 'Plan mode thread', cwd: process.cwd() });
      await appServerRpc('thread/memoryMode/set', { threadId: startedThread.thread.id, mode: 'disabled' });

      await appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Plan before editing.' }],
        collaborationMode: { mode: 'plan' },
      });
      const body = await withTimeout(capture.nextBody, 1500, 'Timed out waiting for plan mode provider request');
      const messages = Array.isArray(body.messages) ? body.messages : [];

      expect(body.reasoning_effort).toBe('medium');
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice === undefined || body.tool_choice === 'none').toBe(true);
      expect(messages.some((message) => String((message as { content?: unknown }).content).includes('<plan_mode>'))).toBe(true);
    } finally {
      await capture.close();
    }
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

  it('supports AppServer fs methods inside registered workspaces', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-'));
    await runtimeFetch('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ path: projectDir, name: 'AppServer fs' }),
    });
    const sourceDir = path.join(projectDir, 'source');
    const nestedDir = path.join(sourceDir, 'nested');
    const nestedFile = path.join(nestedDir, 'blob.bin');
    const copiedFile = path.join(projectDir, 'copy.bin');
    const copiedDir = path.join(projectDir, 'copied');
    const bytes = Buffer.from([0, 1, 2, 255]);

    await expect(appServerRpc('fs/createDirectory', {
      path: nestedDir,
    })).resolves.toEqual({});
    await expect(appServerRpc('fs/writeFile', {
      path: nestedFile,
      dataBase64: bytes.toString('base64'),
    })).resolves.toEqual({});
    await expect(readFile(nestedFile)).resolves.toEqual(bytes);

    await expect(appServerRpc('fs/readFile', { path: nestedFile })).resolves.toEqual({
      dataBase64: bytes.toString('base64'),
    });
    await expect(appServerRpc('fs/getMetadata', { path: nestedFile })).resolves.toMatchObject({
      isDirectory: false,
      isFile: true,
      isSymlink: false,
      createdAtMs: expect.any(Number),
      modifiedAtMs: expect.any(Number),
    });
    await expect(appServerRpc('fs/readDirectory', { path: sourceDir })).resolves.toEqual({
      entries: [
        {
          fileName: 'nested',
          isDirectory: true,
          isFile: false,
        },
      ],
    });

    await expect(appServerRpc('fs/copy', {
      sourcePath: nestedFile,
      destinationPath: copiedFile,
      recursive: false,
    })).resolves.toEqual({});
    await expect(readFile(copiedFile)).resolves.toEqual(bytes);
    await expect(appServerRpc('fs/copy', {
      sourcePath: sourceDir,
      destinationPath: copiedDir,
      recursive: true,
    })).resolves.toEqual({});
    await expect(readFile(path.join(copiedDir, 'nested', 'blob.bin'))).resolves.toEqual(bytes);

    await expect(appServerRpc('fs/remove', { path: copiedDir })).resolves.toEqual({});
    await expect(readFile(path.join(copiedDir, 'nested', 'blob.bin'))).rejects.toThrow();
  });

  it('streams AppServer fs/watch changes and scopes fs/unwatch to the owner connection', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-watch-'));
    await runtimeFetch('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ path: projectDir, name: 'AppServer fs watch' }),
    });
    const watchDir = path.join(projectDir, '.git');
    const changedFile = path.join(watchDir, 'FETCH_HEAD');
    await mkdir(watchDir, { recursive: true });
    await writeFile(changedFile, 'old\n');

    const ownerConnectionId = 'fs-watch-owner';
    const foreignConnectionId = 'fs-watch-foreign';
    const watchId = 'watch-git-dir';
    const ownerStream = await openAppServerNotificationStream({ connectionId: ownerConnectionId });
    const foreignStream = await openAppServerNotificationStream({ connectionId: foreignConnectionId });
    try {
      await expect(appServerRpc('fs/watch', {
        watchId,
        path: watchDir,
      }, { connectionId: ownerConnectionId })).resolves.toEqual({ path: watchDir });

      await expect(appServerRpcEnvelope({
        id: 'duplicate_fs_watch',
        method: 'fs/watch',
        params: { watchId, path: changedFile },
      }, { connectionId: ownerConnectionId })).resolves.toMatchObject({
        id: 'duplicate_fs_watch',
        error: {
          code: -32600,
          message: 'watchId already exists: watch-git-dir',
        },
      });

      await expect(appServerRpc('fs/unwatch', { watchId }, { connectionId: foreignConnectionId })).resolves.toEqual({});

      let changed: AppServerStreamNotification | null = null;
      for (let attempt = 0; attempt < 8 && !changed; attempt += 1) {
        await writeFile(changedFile, `updated:${attempt}\n`);
        changed = await ownerStream.readNotification((notification) => (
          notification.method === 'fs/changed'
          && notification.params?.watchId === watchId
          && Array.isArray(notification.params.changedPaths)
          && notification.params.changedPaths.includes(changedFile)
        ), { timeoutMs: 600 });
      }

      expect(changed).toMatchObject({
        method: 'fs/changed',
        params: {
          watchId,
          changedPaths: expect.arrayContaining([changedFile]),
        },
      });
      await expect(foreignStream.readNotification((notification) => notification.method === 'fs/changed', { timeoutMs: 250 }))
        .resolves.toBeNull();

      await expect(appServerRpc('fs/unwatch', { watchId }, { connectionId: ownerConnectionId })).resolves.toEqual({});
      await writeFile(path.join(watchDir, 'packed-refs'), 'refs\n');

      const missingFile = path.join(watchDir, 'MERGE_HEAD');
      const missingWatchId = 'watch-missing-file';
      await expect(appServerRpc('fs/watch', {
        watchId: missingWatchId,
        path: missingFile,
      }, { connectionId: ownerConnectionId })).resolves.toEqual({ path: missingFile });

      let missingChanged: AppServerStreamNotification | null = null;
      for (let attempt = 0; attempt < 8 && !missingChanged; attempt += 1) {
        await writeFile(missingFile, `merge:${attempt}\n`);
        missingChanged = await ownerStream.readNotification((notification) => (
          notification.method === 'fs/changed'
          && notification.params?.watchId === missingWatchId
          && Array.isArray(notification.params.changedPaths)
          && notification.params.changedPaths.includes(missingFile)
        ), { timeoutMs: 600 });
      }

      expect(missingChanged).toMatchObject({
        method: 'fs/changed',
        params: {
          watchId: missingWatchId,
          changedPaths: expect.arrayContaining([missingFile]),
        },
      });

      await expect(appServerRpc('fs/unwatch', { watchId: missingWatchId }, { connectionId: ownerConnectionId })).resolves.toEqual({});
      await writeFile(path.join(watchDir, 'ORIG_HEAD'), 'refs\n');
      await expect(ownerStream.readNotification((notification) => notification.method === 'fs/changed', { timeoutMs: 500 }))
        .resolves.toBeNull();
    } finally {
      await ownerStream.close();
      await foreignStream.close();
    }
  }, 10_000);

  it('rejects unsafe AppServer fs requests', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-safe-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-fs-outside-'));
    await runtimeFetch('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ path: projectDir, name: 'AppServer fs safety' }),
    });

    await expect(appServerRpcEnvelope({
      id: 'relative_fs_read',
      method: 'fs/readFile',
      params: { path: 'relative.txt' },
    })).resolves.toMatchObject({
      id: 'relative_fs_read',
      error: {
        code: -32602,
        message: 'fs/readFile path must be an absolute path',
      },
    });

    await expect(appServerRpcEnvelope({
      id: 'outside_fs_write',
      method: 'fs/writeFile',
      params: {
        path: path.join(outsideDir, 'outside.txt'),
        dataBase64: Buffer.from('outside').toString('base64'),
      },
    })).resolves.toMatchObject({
      id: 'outside_fs_write',
      error: {
        code: -32600,
        message: expect.stringContaining('outside registered workspaces'),
      },
    });

    await expect(appServerRpcEnvelope({
      id: 'invalid_fs_base64',
      method: 'fs/writeFile',
      params: {
        path: path.join(projectDir, 'invalid.bin'),
        dataBase64: '%%%',
      },
    })).resolves.toMatchObject({
      id: 'invalid_fs_base64',
      error: {
        code: -32602,
        message: expect.stringContaining('fs/writeFile requires valid base64 dataBase64'),
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

  it('builds AppServer command/exec sandbox profiles from sandboxPolicy', () => {
    const cwd = path.join(tmpdir(), 'setsuna app-server command sandbox');
    const writableRoot = path.join(cwd, 'generated');
    const profile = appServerCommandSandboxProfile({
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [writableRoot],
        networkAccess: false,
      },
    }, cwd, { supported: true, provider: 'macos-seatbelt', reason: '' });

    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(deny file-write*');
    expect(profile).toContain(`(require-not (subpath ${JSON.stringify(path.resolve(writableRoot))}))`);
  });

  it('accepts upstream AppServer command/exec permission profile ids', () => {
    const cwd = path.join(tmpdir(), 'setsuna app-server command profile');
    const profile = appServerCommandSandboxProfile({
      permissionProfile: ':workspace',
    }, cwd, { supported: true, provider: 'macos-seatbelt', reason: '' });

    expect(profile).toContain('(deny network*)');
    expect(profile).toContain(`(require-not (subpath ${JSON.stringify(path.resolve(cwd))}))`);
    expect(appServerCommandSandboxProfile({
      permissionProfile: ':danger-full-access',
    }, cwd, { supported: false, provider: 'none', reason: 'unsupported platform: test' })).toBe('');
  });

  it('accepts AppServer command/exec externalSandbox policy without local enforcement', () => {
    expect(appServerCommandSandboxProfile({
      sandboxPolicy: { type: 'externalSandbox', networkAccess: 'enabled' },
    }, process.cwd(), { supported: false, provider: 'none', reason: 'unsupported platform: test' })).toBe('');
  });

  it('fails closed for AppServer command/exec sandboxPolicy when OS sandbox is unavailable', () => {
    expect(() => appServerCommandSandboxProfile({
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    }, process.cwd(), { supported: false, provider: 'none', reason: 'unsupported platform: test' })).toThrow('OS sandbox is unavailable');
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

  it('streams AppServer command/exec output through server notifications', async () => {
    const processId = `streaming-process-${Date.now()}`;
    const outputPromise = readAppServerNotificationStreamContains(Buffer.from('stream').toString('base64'), { timeoutMs: 3000 });

    await expect(appServerRpc('command/exec', {
      command: [process.execPath, '-e', 'process.stdout.write("stream")'],
      processId,
      streamStdoutStderr: true,
      timeoutMs: 5_000,
    })).resolves.toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    await expect(outputPromise).resolves.toBe(true);
  });

  it('supports AppServer command/exec PTY sessions and resize', async () => {
    const processId = `pty-command-${Date.now()}`;
    const readyPromise = readAppServerNotificationDecodedOutputContains(
      'command/exec/outputDelta',
      'processId',
      processId,
      'tty:true',
      { timeoutMs: 10_000 },
    );
    const outputPromise = readAppServerNotificationDecodedOutputContains(
      'command/exec/outputDelta',
      'processId',
      processId,
      'echo:world',
      { timeoutMs: 10_000 },
    );

    const execPromise = appServerRpc('command/exec', {
      command: [process.execPath, '-e', interactiveEchoScript('echo')],
      processId,
      tty: true,
      size: { rows: 31, cols: 101 },
      timeoutMs: 10_000,
    });

    await expect(readyPromise).resolves.toBe(true);
    await expect(appServerRpc('command/exec/resize', {
      processId,
      size: { rows: 32, cols: 102 },
    })).resolves.toEqual({});
    await expect(appServerRpc('command/exec/write', {
      processId,
      deltaBase64: Buffer.from('world\n').toString('base64'),
    })).resolves.toEqual({});

    await expect(outputPromise).resolves.toBe(true);
    await expect(execPromise).resolves.toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  }, 10_000);

  it('scopes AppServer command/exec process ids to explicit event-stream connections', async () => {
    const processId = `shared-command-${Date.now()}`;
    const firstConnectionId = `command-conn-a-${Date.now()}`;
    const secondConnectionId = `command-conn-b-${Date.now()}`;
    const firstStream = await openAppServerNotificationStream({ connectionId: firstConnectionId });
    const secondStream = await openAppServerNotificationStream({ connectionId: secondConnectionId });
    let firstExecPromise: Promise<Record<string, any>> | undefined;
    let secondExecPromise: Promise<Record<string, any>> | undefined;

    try {
      firstExecPromise = appServerRpc('command/exec', {
        command: [process.execPath, '-e', persistentOutputScript('command-one')],
        processId,
        streamStdoutStderr: true,
        timeoutMs: 10_000,
      }, { connectionId: firstConnectionId });
      await expect(firstStream.readDecodedOutputContains(
        'command/exec/outputDelta',
        'processId',
        processId,
        'ready:command-one',
        { timeoutMs: 5_000 },
      )).resolves.toBe(true);

      secondExecPromise = appServerRpc('command/exec', {
        command: [process.execPath, '-e', persistentOutputScript('command-two')],
        processId,
        streamStdoutStderr: true,
        timeoutMs: 10_000,
      }, { connectionId: secondConnectionId });
      await expect(secondStream.readDecodedOutputContains(
        'command/exec/outputDelta',
        'processId',
        processId,
        'ready:command-two',
        { timeoutMs: 5_000 },
      )).resolves.toBe(true);

      await firstStream.close();
      await expect(firstExecPromise).resolves.toMatchObject({ stdout: '', stderr: '' });
      await sleep(50);
      await expect(appServerRpc('command/exec/terminate', { processId }, { connectionId: secondConnectionId })).resolves.toEqual({});
      await expect(secondExecPromise).resolves.toMatchObject({ stdout: '', stderr: '' });
    } finally {
      await firstStream.close();
      await secondStream.close();
      if (firstExecPromise) await firstExecPromise.catch(() => undefined);
      if (secondExecPromise) await secondExecPromise.catch(() => undefined);
    }
  }, 20_000);

  it('spawns AppServer processes and emits process exit notifications', async () => {
    const processHandle = `process-buffered-${Date.now()}`;
    const exitedPromise = readAppServerNotificationStreamContains('"stdout":"proc-out"', { timeoutMs: 3000 });

    await expect(appServerRpc('process/spawn', {
      command: [process.execPath, '-e', 'process.stdout.write("proc-out")'],
      processHandle,
      cwd: process.cwd(),
      timeoutMs: 5_000,
    })).resolves.toEqual({});

    await expect(exitedPromise).resolves.toBe(true);
  });

  it('streams AppServer process output through server notifications', async () => {
    const processHandle = `process-stream-${Date.now()}`;
    const outputPromise = readAppServerNotificationStreamContains(Buffer.from('proc-stream').toString('base64'), { timeoutMs: 3000 });

    await expect(appServerRpc('process/spawn', {
      command: [process.execPath, '-e', 'process.stdout.write("proc-stream")'],
      processHandle,
      cwd: process.cwd(),
      streamStdoutStderr: true,
      timeoutMs: 5_000,
    })).resolves.toEqual({});

    await expect(outputPromise).resolves.toBe(true);
  });

  it('scopes AppServer process/spawn handles to explicit event-stream connections', async () => {
    const processHandle = `shared-process-${Date.now()}`;
    const firstConnectionId = `process-conn-a-${Date.now()}`;
    const secondConnectionId = `process-conn-b-${Date.now()}`;
    const firstStream = await openAppServerNotificationStream({ connectionId: firstConnectionId });
    const secondStream = await openAppServerNotificationStream({ connectionId: secondConnectionId });

    try {
      await expect(appServerRpc('process/spawn', {
        command: [process.execPath, '-e', persistentOutputScript('process-one')],
        processHandle,
        cwd: process.cwd(),
        streamStdoutStderr: true,
        timeoutMs: 10_000,
      }, { connectionId: firstConnectionId })).resolves.toEqual({});
      await expect(firstStream.readDecodedOutputContains(
        'process/outputDelta',
        'processHandle',
        processHandle,
        'ready:process-one',
        { timeoutMs: 5_000 },
      )).resolves.toBe(true);

      await expect(appServerRpc('process/spawn', {
        command: [process.execPath, '-e', persistentOutputScript('process-two')],
        processHandle,
        cwd: process.cwd(),
        streamStdoutStderr: true,
        timeoutMs: 10_000,
      }, { connectionId: secondConnectionId })).resolves.toEqual({});
      await expect(secondStream.readDecodedOutputContains(
        'process/outputDelta',
        'processHandle',
        processHandle,
        'ready:process-two',
        { timeoutMs: 5_000 },
      )).resolves.toBe(true);

      await expect(appServerRpc('process/kill', { processHandle }, { connectionId: firstConnectionId })).resolves.toEqual({});
      await sleep(50);
      await expect(appServerRpc('process/kill', { processHandle }, { connectionId: secondConnectionId })).resolves.toEqual({});
    } finally {
      await firstStream.close();
      await secondStream.close();
    }
  }, 20_000);

  it('supports AppServer process/spawn PTY sessions and resize', async () => {
    const processHandle = `pty-process-${Date.now()}`;
    const readyPromise = readAppServerNotificationDecodedOutputContains(
      'process/outputDelta',
      'processHandle',
      processHandle,
      'tty:true',
      { timeoutMs: 5_000 },
    );
    const outputPromise = readAppServerNotificationDecodedOutputContains(
      'process/outputDelta',
      'processHandle',
      processHandle,
      'spawn:world',
      { timeoutMs: 5_000 },
    );
    const exitedPromise = readAppServerNotificationStreamContains(
      `"processHandle":"${processHandle}"`,
      { timeoutMs: 5_000 },
    );

    await expect(appServerRpc('process/spawn', {
      command: [process.execPath, '-e', interactiveEchoScript('spawn')],
      processHandle,
      cwd: process.cwd(),
      tty: true,
      size: { rows: 29, cols: 99 },
      timeoutMs: 5_000,
    })).resolves.toEqual({});

    await expect(readyPromise).resolves.toBe(true);
    await expect(appServerRpc('process/resizePty', {
      processHandle,
      size: { rows: 30, cols: 100 },
    })).resolves.toEqual({});
    await expect(appServerRpc('process/writeStdin', {
      processHandle,
      deltaBase64: Buffer.from('world\n').toString('base64'),
    })).resolves.toEqual({});

    await expect(outputPromise).resolves.toBe(true);
    await expect(exitedPromise).resolves.toBe(true);
  });

  it('writes stdin to AppServer process sessions', async () => {
    const processHandle = `process-stdin-${Date.now()}`;
    const exitedPromise = readAppServerNotificationStreamContains('"stdout":"stdin:hello"', { timeoutMs: 3000 });

    await expect(appServerRpc('process/spawn', {
      command: [
        process.execPath,
        '-e',
        'let data = ""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(`stdin:${data}`));',
      ],
      processHandle,
      cwd: process.cwd(),
      streamStdin: true,
      timeoutMs: 5_000,
    })).resolves.toEqual({});

    await expect(appServerRpc('process/writeStdin', {
      processHandle,
      deltaBase64: Buffer.from('hello').toString('base64'),
      closeStdin: true,
    })).resolves.toEqual({});

    await expect(exitedPromise).resolves.toBe(true);
  });

  it('kills AppServer process sessions and rejects PTY resize for non-PTY processes', async () => {
    const processHandle = `process-kill-${Date.now()}`;
    const exitedPromise = readAppServerNotificationStreamContains('"method":"process/exited"', { timeoutMs: 3000 });

    await expect(appServerRpc('process/spawn', {
      command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      processHandle,
      cwd: process.cwd(),
      timeoutMs: null,
    })).resolves.toEqual({});

    await expect(appServerRpcEnvelope({
      id: 'resize_process',
      method: 'process/resizePty',
      params: { processHandle, size: { rows: 24, cols: 80 } },
    })).resolves.toMatchObject({
      id: 'resize_process',
      error: {
        code: -32600,
        message: expect.stringContaining('PTY-backed process'),
      },
    });

    await expect(appServerRpc('process/kill', { processHandle })).resolves.toEqual({});
    await expect(exitedPromise).resolves.toBe(true);
  });

  it('lists and terminates AppServer background terminals by thread', async () => {
    const startedThread = await appServerRpc('thread/start', { name: 'Background terminals', cwd: process.cwd() });
    const otherThread = await appServerRpc('thread/start', { name: 'Other background terminals', cwd: process.cwd() });
    const connectionId = `background-terminals-${Date.now()}`;
    const processHandle = `background-terminal-${Date.now()}`;
    try {
      await expect(appServerRpc('process/spawn', {
        command: [process.execPath, '-e', persistentOutputScript('background-terminal')],
        processHandle,
        cwd: process.cwd(),
        threadId: startedThread.thread.id,
        tty: true,
        timeoutMs: null,
      }, { connectionId })).resolves.toEqual({});

      await expect(appServerRpc('thread/backgroundTerminals/list', {
        threadId: startedThread.thread.id,
      }, { connectionId })).resolves.toEqual({
        data: [
          expect.objectContaining({
            cwd: process.cwd(),
            processHandle,
            threadId: startedThread.thread.id,
            tty: true,
          }),
        ],
      });
      await expect(appServerRpc('thread/backgroundTerminals/list', {
        threadId: otherThread.thread.id,
      }, { connectionId })).resolves.toEqual({ data: [] });
      await expect(appServerRpc('thread/backgroundTerminals/terminate', {
        threadId: startedThread.thread.id,
        processHandle,
      }, { connectionId })).resolves.toEqual({ terminated: true });
      await expect(appServerRpc('thread/backgroundTerminals/terminate', {
        threadId: startedThread.thread.id,
        processHandle,
      }, { connectionId })).resolves.toEqual({ terminated: false });
      await expect(appServerRpc('thread/backgroundTerminals/list', {
        threadId: startedThread.thread.id,
      }, { connectionId })).resolves.toEqual({ data: [] });
    } finally {
      await appServerRpc('process/kill', { processHandle }, { connectionId }).catch(() => undefined);
    }
  });

  it('cleans AppServer background terminals for a thread without touching other threads', async () => {
    const firstThread = await appServerRpc('thread/start', { name: 'Background clean A', cwd: process.cwd() });
    const secondThread = await appServerRpc('thread/start', { name: 'Background clean B', cwd: process.cwd() });
    const connectionId = `background-clean-${Date.now()}`;
    const firstHandle = `background-clean-a-${Date.now()}`;
    const secondHandle = `background-clean-b-${Date.now()}`;
    try {
      await expect(appServerRpc('process/spawn', {
        command: [process.execPath, '-e', persistentOutputScript('background-clean-a')],
        processHandle: firstHandle,
        cwd: process.cwd(),
        threadId: firstThread.thread.id,
        timeoutMs: null,
      }, { connectionId })).resolves.toEqual({});
      await expect(appServerRpc('process/spawn', {
        command: [process.execPath, '-e', persistentOutputScript('background-clean-b')],
        processHandle: secondHandle,
        cwd: process.cwd(),
        threadId: secondThread.thread.id,
        timeoutMs: null,
      }, { connectionId })).resolves.toEqual({});

      await expect(appServerRpc('thread/backgroundTerminals/clean', {
        threadId: firstThread.thread.id,
      }, { connectionId })).resolves.toEqual({});

      await expect(appServerRpc('thread/backgroundTerminals/list', {
        threadId: firstThread.thread.id,
      }, { connectionId })).resolves.toEqual({ data: [] });
      await expect(appServerRpc('thread/backgroundTerminals/list', {
        threadId: secondThread.thread.id,
      }, { connectionId })).resolves.toEqual({
        data: [expect.objectContaining({ processHandle: secondHandle })],
      });
    } finally {
      await appServerRpc('process/kill', { processHandle: firstHandle }, { connectionId }).catch(() => undefined);
      await appServerRpc('process/kill', { processHandle: secondHandle }, { connectionId }).catch(() => undefined);
    }
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

    const compactionSummary = compacted.messages.find((message) => message.contextCompaction);

    expect(compactionSummary?.content).toContain('<context_compaction_summary');
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
      (item) => item.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('manual') === true),
    );
    const hasContextCompactionItem = await readEventStreamContains(
      thread.id,
      0,
      '"type":"contextCompaction"',
      { format: 'swe' },
    );
    const read = await appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });

    const compactionSummary = compacted.messages.find((message) => message.contextCompaction);

    expect(compactionSummary?.turnId).toBeTruthy();
    expect(read.thread.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: compactionSummary?.turnId,
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
    const hasUserShellTaskKind = await readEventStreamContains(
      thread.id,
      0,
      '"taskKind":"user_shell"',
    );
    const read = await appServerRpc('thread/read', { threadId: thread.id, includeTurns: true });

    expect(hasUserShellItem).toBe(true);
    expect(hasOutputDelta).toBe(true);
    expect(hasRuntimeOutputDelta).toBe(true);
    expect(hasUserShellTaskKind).toBe(true);
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

      const beforeRelease = await runtimeFetch(`/v1/threads/${encodeURIComponent(startedThread.thread.id)}`);
      expect(beforeRelease.messages.find((message: { clientId?: string }) => message.clientId === 'client-steer-message-1')).toMatchObject({
        content: 'Steer this active turn.',
        role: 'user',
        turnId: startedTurn.turn.id,
      });
      capture.release();
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

  it('delivers AppServer mailbox input into the active turn', async () => {
    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'mailbox-provider',
          providers: [
            {
              id: 'mailbox-provider',
              name: 'Mailbox provider',
              provider: 'openai-compatible',
              baseUrl: capture.baseUrl,
              apiKey: 'sk-mailbox',
              enabled: true,
              models: [
                {
                  id: 'mailbox-model',
                  name: 'Mailbox model',
                  code: 'mailbox-model',
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
      const startedThread = await appServerRpc('thread/start', { name: 'Mailbox active AppServer turn', cwd: process.cwd() });
      const startedTurn = await appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        clientUserMessageId: 'client-start-message-1',
        input: [{ type: 'text', text: 'Keep this turn active.' }],
      });
      await withTimeout(capture.nextBody, 1500, 'Timed out waiting for delayed provider request');

      await expect(appServerRpc('turn/mailbox/deliver', {
        threadId: startedThread.thread.id,
        expectedTurnId: startedTurn.turn.id,
        id: 'mail_appserver_1',
        fromAgentId: 'agent_child',
        content: 'child agent found the app-server regression',
      })).resolves.toEqual({ queued: false, turnId: startedTurn.turn.id });

      const hasMailboxEvent = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"type":"mailbox.delivered"',
      );
      const hasCollabItem = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"type":"collabToolCall"',
        { format: 'swe' },
      );
      capture.release();
      const updated = await waitForThread(startedThread.thread.id, (item) => item.activeTurnId === null);

      expect(hasMailboxEvent).toBe(true);
      expect(hasCollabItem).toBe(true);
      expect(updated.messages.filter((message) => message.turnId === startedTurn.turn.id && message.role === 'user')).toHaveLength(1);
    } finally {
      capture.release();
      await capture.close();
    }
  });

  it('starts an AppServer trigger-turn mailbox delivery when the thread is idle', async () => {
    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await configureOpenAiProvider('mailbox-trigger-provider', capture.baseUrl);
      const startedThread = await appServerRpc('thread/start', { name: 'Mailbox trigger AppServer turn', cwd: process.cwd() });

      const delivered = await appServerRpc('turn/mailbox/deliver', {
        threadId: startedThread.thread.id,
        id: 'mail_appserver_trigger_1',
        deliveryMode: 'trigger_turn',
        fromAgentId: 'agent_child',
        fromThreadId: 'thread_child',
        toAgentId: 'agent_parent',
        content: 'wake the idle app-server parent',
      });
      const body = await withTimeout(capture.nextBody, 1500, 'Timed out waiting for trigger mailbox provider request');
      const requestText = JSON.stringify(body);

      expect(delivered).toEqual({ queued: false, turnId: expect.any(String) });
      expect(requestText).toContain('mailbox_message');
      expect(requestText).toContain('mail_appserver_trigger_1');
      expect(requestText).toContain('wake the idle app-server parent');
      expect(requestText).toContain('trigger_turn');

      const hasMailboxEvent = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"type":"mailbox.delivered"',
      );
      const hasCollabItem = await readEventStreamContains(
        startedThread.thread.id,
        0,
        '"tool":"resume_agent"',
        { format: 'swe' },
      );
      capture.release();
      const updated = await waitForThread(startedThread.thread.id, (item) => item.activeTurnId === null);

      expect(hasMailboxEvent).toBe(true);
      expect(hasCollabItem).toBe(true);
      expect(updated.messages.filter((message) => message.turnId === delivered.turnId && message.role === 'user')).toHaveLength(0);
    } finally {
      capture.release();
      await capture.close();
    }
  });

  it('routes AppServer dynamic tool calls through item/tool/call responses', async () => {
    const modelServer = await createOpenAiDynamicToolServer();
    const connectionId = 'dynamic-tool-session';
    await appServerRpc('initialize', {
      clientInfo: { name: 'setsuna-dynamic-tool-test', version: 'test' },
      capabilities: { experimentalApi: true },
    }, { connectionId });
    const stream = await openAppServerNotificationStream({ connectionId });
    try {
      await configureOpenAiProvider('dynamic-tool-provider', modelServer.baseUrl);
      const startedThread = await appServerRpc('thread/start', {
        name: 'Dynamic tool AppServer turn',
        cwd: process.cwd(),
        dynamicTools: [
          {
            name: 'tickets',
            description: 'Ticket tools.',
            tools: [
              {
                name: 'lookup_ticket',
                description: 'Look up a ticket by id.',
                inputSchema: {
                  type: 'object',
                  properties: { id: { type: 'string' } },
                  required: ['id'],
                },
              },
            ],
          },
        ],
      }, { connectionId });

      const startedTurn = await appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Look up ticket ABC-123.' }],
      }, { connectionId });
      const request = await stream.readNotification((notification) => (
        notification.method === 'item/tool/call'
        && notification.params?.threadId === startedThread.thread.id
      ), { timeoutMs: 3000 });

      expect(request).toMatchObject({
        method: 'item/tool/call',
        id: expect.any(String),
        params: {
          threadId: startedThread.thread.id,
          turnId: startedTurn.turn.id,
          callId: 'call_dynamic_1',
          namespace: 'tickets',
          tool: 'lookup_ticket',
          arguments: { id: 'ABC-123' },
        },
      });

      await expect(appServerRpcResponseEnvelope({
        id: request?.id,
        result: {
          contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
          success: true,
        },
      }, { connectionId })).resolves.toBeNull();

      const updated = await waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) =>
          message.turnId === startedTurn.turn.id
          && message.role === 'assistant'
          && message.status === 'complete'
          && message.content.includes('Dynamic tool result received.')
        ),
      );
      const requests = await withTimeout(modelServer.requests, 1500, 'Timed out waiting for dynamic tool model requests');
      const read = await appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
      const turn = read.thread.turns.find((item: { id: string }) => item.id === startedTurn.turn.id);

      expect(JSON.stringify(requests[0])).toContain('tickets__lookup_ticket');
      expect(JSON.stringify(requests[1])).toContain('Ticket ABC-123 is open.');
      expect(updated.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call_dynamic_1',
          toolName: 'tickets__lookup_ticket',
          content: 'Ticket ABC-123 is open.',
        }),
      ]));
      expect(turn?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'dynamicToolCall',
          tool: 'tickets__lookup_ticket',
          contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
          success: true,
        }),
      ]));
    } finally {
      await stream.close();
      await modelServer.close();
    }
  });

  it('requires experimental AppServer capability for dynamic tools', async () => {
    await expect(appServerRpcEnvelope({
      id: 'dynamic_tools_no_capability',
      method: 'thread/start',
      params: {
        name: 'Dynamic tool rejected',
        cwd: process.cwd(),
        dynamicTools: [{ name: 'lookup', description: 'Lookup.', inputSchema: { type: 'object' } }],
      },
    }, { connectionId: 'dynamic-tool-rejected-session' })).resolves.toMatchObject({
      id: 'dynamic_tools_no_capability',
      error: {
        code: -32600,
        message: 'dynamicTools requires initialize.params.capabilities.experimentalApi = true',
      },
    });
  });

  it('reveals deferred AppServer dynamic tools through tool_search', async () => {
    const modelServer = await createOpenAiDeferredDynamicToolServer();
    const connectionId = 'deferred-dynamic-tool-session';
    await appServerRpc('initialize', {
      clientInfo: { name: 'setsuna-deferred-dynamic-tool-test', version: 'test' },
      capabilities: { experimentalApi: true },
    }, { connectionId });
    const stream = await openAppServerNotificationStream({ connectionId });
    try {
      await configureOpenAiProvider('deferred-dynamic-tool-provider', modelServer.baseUrl);
      const startedThread = await appServerRpc('thread/start', {
        name: 'Deferred dynamic tool AppServer turn',
        cwd: process.cwd(),
        dynamicTools: [
          {
            name: 'tickets',
            description: 'Ticket tools.',
            tools: [
              {
                name: 'lookup_ticket',
                description: 'Look up a ticket by id.',
                deferLoading: true,
                inputSchema: {
                  type: 'object',
                  properties: { id: { type: 'string' } },
                  required: ['id'],
                },
              },
            ],
          },
        ],
      }, { connectionId });

      const startedTurn = await appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Find the deferred lookup tool, then look up ticket ABC-123.' }],
      }, { connectionId });
      const request = await stream.readNotification((notification) => (
        notification.method === 'item/tool/call'
        && notification.params?.threadId === startedThread.thread.id
      ), { timeoutMs: 3000 });

      expect(request).toMatchObject({
        method: 'item/tool/call',
        id: expect.any(String),
        params: {
          threadId: startedThread.thread.id,
          turnId: startedTurn.turn.id,
          callId: 'call_deferred_dynamic_1',
          namespace: 'tickets',
          tool: 'lookup_ticket',
          arguments: { id: 'ABC-123' },
        },
      });

      await expect(appServerRpcResponseEnvelope({
        id: request?.id,
        result: {
          contentItems: [{ type: 'inputText', text: 'Deferred ticket ABC-123 is open.' }],
          success: true,
        },
      }, { connectionId })).resolves.toBeNull();

      await waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) =>
          message.turnId === startedTurn.turn.id
          && message.role === 'assistant'
          && message.status === 'complete'
          && message.content.includes('Deferred dynamic tool result received.')
        ),
      );
      const requests = await withTimeout(modelServer.requests, 1500, 'Timed out waiting for deferred dynamic model requests');

      expect(JSON.stringify(requests[0])).toContain('tool_search');
      expect(JSON.stringify(requests[0])).not.toContain('tickets__lookup_ticket');
      expect(JSON.stringify(requests[1])).toContain('tickets__lookup_ticket');
      expect(JSON.stringify(requests[2])).toContain('Deferred ticket ABC-123 is open.');
    } finally {
      await stream.close();
      await modelServer.close();
    }
  });

  it('steers additional REST user input into the active turn', async () => {
    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await configureOpenAiProvider('rest-steer-provider', capture.baseUrl);
      const thread = await runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'REST steer active turn' }),
      });
      const started = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ clientId: 'rest-start-message-1', input: 'Keep this REST turn active.' }),
      });
      await withTimeout(capture.nextBody, 1500, 'Timed out waiting for delayed REST provider request');

      const activeSnapshot = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
      expect(activeSnapshot.activeTurnId).toBe(started.turnId);

      await expect(runtimeFetch(
        `/v1/threads/${encodeURIComponent(thread.id)}/turns/${encodeURIComponent(started.turnId)}/steer`,
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: 'rest-steer-message-1',
            expectedTurnId: started.turnId,
            input: 'Steer this REST active turn.',
          }),
        },
      )).resolves.toEqual({ accepted: true, turnId: started.turnId });

      const beforeRelease = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
      expect(beforeRelease.messages.find((message: { clientId?: string }) => message.clientId === 'rest-steer-message-1')).toMatchObject({
        content: 'Steer this REST active turn.',
        role: 'user',
        turnId: started.turnId,
      });
      capture.release();
      const updated = await waitForThread(
        thread.id,
        (item) => item.messages.some((message) =>
          message.turnId === started.turnId
          && message.role === 'user'
          && message.clientId === 'rest-steer-message-1'
        ),
      );

      expect(updated.messages.filter((message) => message.turnId === started.turnId && message.role === 'user')).toHaveLength(2);
      expect(updated.messages.find((message) => message.clientId === 'rest-steer-message-1')).toMatchObject({
        content: 'Steer this REST active turn.',
        role: 'user',
        turnId: started.turnId,
      });
    } finally {
      capture.release();
      await capture.close();
    }
  });

  it('treats REST turn starts during an active conversation as steering the active turn', async () => {
    const capture = await createDelayedOpenAiCaptureServer();
    try {
      await configureOpenAiProvider('rest-start-steer-provider', capture.baseUrl);
      const thread = await runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'REST start while active' }),
      });
      const started = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ clientId: 'rest-start-active-1', input: 'Keep this REST turn active.' }),
      });
      await withTimeout(capture.nextBody, 1500, 'Timed out waiting for delayed REST provider request');

      await expect(runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: 'rest-start-while-active-steer',
          input: 'This should stay in the current turn.',
        }),
      })).resolves.toEqual({ accepted: true, turnId: started.turnId });

      const beforeRelease = await runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
      expect(beforeRelease.activeTurnId).toBe(started.turnId);
      expect(beforeRelease.messages.find((message: { clientId?: string }) => message.clientId === 'rest-start-while-active-steer')).toMatchObject({
        content: 'This should stay in the current turn.',
        role: 'user',
        turnId: started.turnId,
      });

      capture.release();
      const updated = await waitForThread(
        thread.id,
        (item) => item.activeTurnId === null
          && item.messages.some((message) =>
            message.turnId === started.turnId
            && message.role === 'user'
            && message.clientId === 'rest-start-while-active-steer'
          ),
      );

      expect(updated.messages.filter((message) => message.turnId === started.turnId && message.role === 'user')).toHaveLength(2);
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

  it('resets AppServer memory files without changing thread memory mode', async () => {
    const storagePath = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-memory-reset-test-'));
    await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({ storagePath }),
    });
    const thread = await runtimeFetch('/v1/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Memory reset', memoryMode: 'disabled' }),
    });
    await runtimeFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'Reset this memory.', scope: 'global' }),
    });
    await mkdir(path.join(storagePath, 'rollout_summaries'), { recursive: true });
    await writeFile(path.join(storagePath, 'rollout_summaries', 'stale.md'), 'stale rollout\n', 'utf8');

    await expect(appServerRpc('memory/reset', {})).resolves.toEqual({});

    await expect(directoryEntries(storagePath)).resolves.toEqual([]);
    await expect(runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`)).resolves.toMatchObject({
      id: thread.id,
      memoryMode: 'disabled',
    });
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
        tools: [{
          name: 'search',
          description: 'Search docs',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          annotations: { readOnlyHint: true },
        }],
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

    await expect(appServerRpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })).resolves.toEqual({
      data: [
        {
          name: 'docs',
          serverInfo: null,
          tools: {
            search: {
              name: 'search',
              description: 'Search docs',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
              annotations: { readOnlyHint: true },
            },
          },
          resources: [],
          resourceTemplates: [],
          authStatus: 'bearerToken',
        },
      ],
      nextCursor: null,
    });
    await expect(appServerRpc('mcpServerStatus/list', { limit: 1, detail: 'toolsAndAuthOnly' })).resolves.toMatchObject({
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

  it('lists MCP resources and resource templates in AppServer full status', async () => {
    const mcpServer = await createMcpToolsServer();
    try {
      await runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs',
          label: 'Docs',
          transport: 'streamableHttp',
          url: mcpServer.baseUrl,
          headers: { Authorization: 'Bearer inventory-secret' },
          tools: [{ name: 'search', description: 'Search docs' }],
        }),
      });

      await expect(appServerRpc('mcpServerStatus/list', {})).resolves.toEqual({
        data: [
          {
            name: 'docs',
            serverInfo: null,
            tools: {
              search: {
                name: 'search',
                description: 'Search docs',
                inputSchema: { type: 'object', properties: {}, additionalProperties: true },
              },
            },
            resources: [
              {
                uri: 'memo://hello',
                name: 'hello',
                title: 'Hello Memo',
                description: 'A memo resource',
                mimeType: 'text/plain',
              },
            ],
            resourceTemplates: [
              {
                uriTemplate: 'memo://{id}',
                name: 'memo',
                title: 'Memo',
                description: 'Memo by id',
                mimeType: 'text/plain',
              },
            ],
            authStatus: 'bearerToken',
          },
        ],
        nextCursor: null,
      });
      expect(await mcpServer.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'resources/list', authorization: 'Bearer inventory-secret' }),
        expect.objectContaining({ method: 'resources/templates/list', authorization: 'Bearer inventory-secret' }),
      ]));
    } finally {
      await mcpServer.close();
    }
  });

  it('reports OAuth-configured MCP servers as not logged in in AppServer status', async () => {
    await runtimeFetch('/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({
        key: 'docs',
        label: 'Docs',
        transport: 'streamableHttp',
        url: 'https://example.com/mcp',
        oauthClientId: 'client-123',
        oauthResource: 'https://resource.example.com',
        tools: [{ name: 'search' }],
      }),
    });

    await expect(appServerRpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })).resolves.toEqual({
      data: [
        {
          name: 'docs',
          serverInfo: null,
          tools: {
            search: {
              name: 'search',
              inputSchema: { type: 'object', properties: {}, additionalProperties: true },
            },
          },
          resources: [],
          resourceTemplates: [],
          authStatus: 'notLoggedIn',
        },
      ],
      nextCursor: null,
    });

    await runtimeFetch('/v1/mcp/servers/docs', {
      method: 'PATCH',
      body: JSON.stringify({ headers: { Authorization: 'Bearer secret' } }),
    });

    await expect(appServerRpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })).resolves.toMatchObject({
      data: [{ name: 'docs', authStatus: 'bearerToken' }],
      nextCursor: null,
    });
  });

  it('handles AppServer MCP reload and OAuth login method boundaries', async () => {
    await expect(appServerRpc('config/mcpServer/reload', {})).resolves.toEqual({});

    await expect(appServerRpcEnvelope({
      id: 'missing_oauth_server',
      method: 'mcpServer/oauth/login',
      params: { name: 'missing' },
    })).resolves.toMatchObject({
      id: 'missing_oauth_server',
      error: { code: -32600, message: "No MCP server named 'missing' found." },
    });

    await runtimeFetch('/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({
        key: 'local',
        transport: 'stdio',
        command: process.execPath,
      }),
    });

    await expect(appServerRpcEnvelope({
      id: 'stdio_oauth_server',
      method: 'mcpServer/oauth/login',
      params: { name: 'local' },
    })).resolves.toMatchObject({
      id: 'stdio_oauth_server',
      error: { code: -32600, message: 'OAuth login is only supported for streamable HTTP servers.' },
    });

    await runtimeFetch('/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({
        key: 'docs',
        transport: 'streamableHttp',
        url: 'https://example.com/mcp',
        oauthClientId: 'client-123',
      }),
    });

    await expect(appServerRpcEnvelope({
      id: 'http_oauth_server',
      method: 'mcpServer/oauth/login',
      params: { name: 'docs', threadId: null, scopes: ['read'], timeoutSecs: 1 },
    })).resolves.toMatchObject({
      id: 'http_oauth_server',
      error: {
        code: -32603,
        message: expect.stringContaining("failed to login to MCP server 'docs'"),
      },
    });
  });

  it('fetches MCP tools through the runtime API', async () => {
    const mcpServer = await createMcpToolsServer();
    try {
      const tools = await runtimeFetch('/v1/mcp/tools', {
        method: 'POST',
        body: JSON.stringify({
          key: 'search',
          transport: 'streamableHttp',
          url: mcpServer.baseUrl,
          headers: { Authorization: 'Bearer secret' },
        }),
      });

      expect(tools).toEqual({
        tools: [
          { name: 'search_web', description: 'Search the web' },
          { name: 'summarize_page' },
        ],
        errors: [],
      });
      expect(await mcpServer.requests).toEqual([
        { method: 'initialize', authorization: 'Bearer secret', session: '' },
        { method: 'notifications/initialized', authorization: 'Bearer secret', session: 'session_1' },
        { method: 'tools/list', authorization: 'Bearer secret', session: 'session_1' },
      ]);
    } finally {
      await mcpServer.close();
    }
  });

  it('resolves codex-style MCP bearer and env HTTP headers for discovery', async () => {
    const mcpServer = await createMcpToolsServer();
    const previousToken = process.env.SETSUNA_MCP_TEST_TOKEN;
    const previousAccount = process.env.SETSUNA_MCP_TEST_ACCOUNT;
    process.env.SETSUNA_MCP_TEST_TOKEN = 'env-secret';
    process.env.SETSUNA_MCP_TEST_ACCOUNT = 'account-42';
    try {
      const tools = await runtimeFetch('/v1/mcp/tools', {
        method: 'POST',
        body: JSON.stringify({
          key: 'search',
          transport: 'streamableHttp',
          url: mcpServer.baseUrl,
          headers: { 'X-Static': 'static-header' },
          envHttpHeaders: { 'X-Account': 'SETSUNA_MCP_TEST_ACCOUNT' },
          bearerTokenEnvVar: 'SETSUNA_MCP_TEST_TOKEN',
        }),
      });

      expect(tools).toMatchObject({ errors: [] });
      expect(await mcpServer.requests).toEqual([
        { method: 'initialize', authorization: 'Bearer env-secret', session: '', account: 'account-42', staticHeader: 'static-header' },
        { method: 'notifications/initialized', authorization: 'Bearer env-secret', session: 'session_1', account: 'account-42', staticHeader: 'static-header' },
        { method: 'tools/list', authorization: 'Bearer env-secret', session: 'session_1', account: 'account-42', staticHeader: 'static-header' },
      ]);
    } finally {
      if (previousToken === undefined) delete process.env.SETSUNA_MCP_TEST_TOKEN;
      else process.env.SETSUNA_MCP_TEST_TOKEN = previousToken;
      if (previousAccount === undefined) delete process.env.SETSUNA_MCP_TEST_ACCOUNT;
      else process.env.SETSUNA_MCP_TEST_ACCOUNT = previousAccount;
      await mcpServer.close();
    }
  });

  it('reads MCP resources through the AppServer API', async () => {
    const mcpServer = await createMcpToolsServer();
    try {
      await runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs',
          transport: 'streamableHttp',
          url: mcpServer.baseUrl,
          headers: { Authorization: 'Bearer resource-secret' },
        }),
      });

      await expect(appServerRpc('mcpServer/resource/read', {
        server: 'docs',
        uri: 'memo://hello',
      })).resolves.toEqual({
        contents: [
          {
            uri: 'memo://hello',
            mimeType: 'text/plain',
            text: 'resource for memo://hello',
          },
        ],
      });
      expect(await mcpServer.requests).toEqual([
        { method: 'initialize', authorization: 'Bearer resource-secret', session: '' },
        { method: 'notifications/initialized', authorization: 'Bearer resource-secret', session: 'session_1' },
        { method: 'resources/read', authorization: 'Bearer resource-secret', session: 'session_1', uri: 'memo://hello' },
      ]);
    } finally {
      await mcpServer.close();
    }
  });

  it('calls MCP tools through the AppServer API', async () => {
    const mcpServer = await createMcpToolsServer();
    const startedThread = await appServerRpc('thread/start', { name: 'MCP tool call', cwd: process.cwd() });
    try {
      await runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs',
          transport: 'streamableHttp',
          url: mcpServer.baseUrl,
          headers: { Authorization: 'Bearer call-secret' },
        }),
      });

      await expect(appServerRpc('mcpServer/tool/call', {
        threadId: startedThread.thread.id,
        server: 'docs',
        tool: 'search_web',
        arguments: { query: 'setsuna' },
      })).resolves.toEqual({
        content: [{ type: 'text', text: 'result for setsuna' }],
        structuredContent: { query: 'setsuna', count: 1 },
        isError: false,
        _meta: { source: 'test-mcp' },
      });
      expect(await mcpServer.requests).toEqual([
        { method: 'initialize', authorization: 'Bearer call-secret', session: '' },
        { method: 'notifications/initialized', authorization: 'Bearer call-secret', session: 'session_1' },
        { method: 'tools/call', authorization: 'Bearer call-secret', session: 'session_1', tool: 'search_web', query: 'setsuna' },
      ]);
    } finally {
      await mcpServer.close();
    }
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

  async function seedStaleRuntimeItemThread(dataDir: string): Promise<string> {
    const now = '2026-06-26T00:00:00.000Z';
    const thread: RuntimeThread = {
      id: 'thread_stale_items',
      title: 'Stale item thread',
      createdAt: now,
      updatedAt: now,
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      activeTurnId: 'turn_stale_items',
      messages: [],
      turns: [{
        id: 'turn_stale_items',
        startedAt: now,
        status: 'in_progress',
        items: [
          { id: 'agent_item_stale', kind: 'agent_message', status: 'in_progress', content: 'Partial answer' },
          { id: 'tool_item_stale', kind: 'tool_call', status: 'in_progress', toolCall: { id: 'tool_item_stale', name: 'workspace_read_file', arguments: '{"path":"README.md"}' } },
        ],
      }],
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

  async function directoryEntries(dir: string): Promise<string[]> {
    return (await readdir(dir)).sort();
  }

  async function configureOpenAiProvider(id: string, providerBaseUrl: string, modelOverrides: Record<string, unknown> = {}) {
    await runtimeFetch('/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        activeProviderId: id,
        providers: [
          {
            id,
            name: id,
            provider: 'openai-compatible',
            baseUrl: providerBaseUrl,
            apiKey: `sk-${id}`,
            enabled: true,
            models: [
              {
                id: `${id}-model`,
                name: `${id} model`,
                code: `${id}-model`,
                enabled: true,
                maxOutputTokens: 1000,
                thinkingEnabled: false,
                thinkingEfforts: [],
                ...modelOverrides,
              },
            ],
          },
        ],
      }),
    });
  }

  async function appServerRpc(method: string, params: Record<string, unknown>, options: AppServerRequestOptions = {}) {
    const response = await appServerRpcEnvelope({ id: method, method, params }, options);
    if ('error' in response) throw new Error(response.error.message);
    return response.result as Record<string, any>;
  }

  async function appServerRpcEnvelope(body: unknown, options: AppServerRequestOptions = {}) {
    return runtimeFetch('/v1/swe/app-server', {
      method: 'POST',
      headers: appServerSessionHeaders(options),
      body: JSON.stringify(body),
    }) as Promise<{ id: unknown; result: any } | { id: unknown; error: { code: number; message: string; data?: unknown } }>;
  }

  async function appServerRpcResponseEnvelope(body: unknown, options: AppServerRequestOptions = {}): Promise<unknown | null> {
    const response = await fetch(`${baseUrl}/v1/swe/app-server`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...appServerSessionHeaders(options),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    if (response.status === 204) return null;
    return response.json();
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

  async function readAppServerNotificationStreamContains(
    needle: string,
    options: AppServerRequestOptions & { timeoutMs?: number } = {},
  ): Promise<boolean> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/v1/swe/app-server/events`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...appServerSessionHeaders(options),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    if (!response.body) throw new Error('Expected app-server notification response body');

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

  async function readAppServerNotificationDecodedOutputContains(
    method: string,
    idKey: string,
    idValue: string,
    needle: string,
    options: AppServerRequestOptions & { timeoutMs?: number } = {},
  ): Promise<boolean> {
    const stream = await openAppServerNotificationStream(options);
    try {
      return await stream.readDecodedOutputContains(method, idKey, idValue, needle, options);
    } finally {
      await stream.close();
    }
  }

  async function openAppServerNotificationStream(options: AppServerRequestOptions = {}): Promise<AppServerNotificationStream> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/v1/swe/app-server/events`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...appServerSessionHeaders(options),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    if (!response.body) throw new Error('Expected app-server notification response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let eventBuffer = '';
    let output = '';
    let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    const readNextChunk = async (deadline: number): Promise<ReadableStreamReadResult<Uint8Array> | null> => {
      if (!pendingRead) pendingRead = reader.read();
      const result = await Promise.race([pendingRead, sleep(Math.max(1, deadline - Date.now())).then(() => null)]);
      if (!result) return null;
      pendingRead = null;
      return result;
    };
    const readNotification = async (
      predicate: (notification: AppServerStreamNotification) => boolean,
      readOptions: { timeoutMs?: number } = {},
    ): Promise<AppServerStreamNotification | null> => {
      const deadline = Date.now() + (readOptions.timeoutMs ?? 1500);
      while (Date.now() < deadline) {
        const result = await readNextChunk(deadline);
        if (!result) break;
        if (result.done) break;
        eventBuffer += decoder.decode(result.value, { stream: true });
        let separator = eventBuffer.indexOf('\n\n');
        while (separator !== -1) {
          const rawEvent = eventBuffer.slice(0, separator);
          eventBuffer = eventBuffer.slice(separator + 2);
          separator = eventBuffer.indexOf('\n\n');
          const data = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice('data: '.length))
            .join('\n');
          if (!data) continue;
          const notification = JSON.parse(data) as AppServerStreamNotification;
          if (predicate(notification)) return notification;
        }
      }
      return null;
    };
    return {
      async readDecodedOutputContains(method, idKey, idValue, needle, readOptions = {}) {
        const deadline = Date.now() + (readOptions.timeoutMs ?? 1500);
        while (Date.now() < deadline) {
          const notification = await readNotification((item) => (
            item.method === method
            && item.params?.[idKey] === idValue
            && typeof item.params.deltaBase64 === 'string'
          ), { timeoutMs: Math.max(1, deadline - Date.now()) });
          if (!notification || typeof notification.params?.deltaBase64 !== 'string') break;
          output += Buffer.from(notification.params.deltaBase64, 'base64').toString('utf8');
          if (output.includes(needle)) return true;
        }
        return false;
      },
      readNotification,
      async close() {
        controller.abort();
        await reader.cancel().catch(() => undefined);
      },
    };
  }

  function appServerSessionHeaders(options: AppServerRequestOptions): Record<string, string> {
    return options.connectionId ? { 'x-setsuna-app-server-connection-id': options.connectionId } : {};
  }
});

type AppServerRequestOptions = {
  connectionId?: string;
};

type AppServerNotificationStream = {
  readDecodedOutputContains(
    method: string,
    idKey: string,
    idValue: string,
    needle: string,
    options?: { timeoutMs?: number },
  ): Promise<boolean>;
  readNotification(
    predicate: (notification: AppServerStreamNotification) => boolean,
    options?: { timeoutMs?: number },
  ): Promise<AppServerStreamNotification | null>;
  close(): Promise<void>;
};

type AppServerStreamNotification = {
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
};

function interactiveEchoScript(prefix: string): string {
  return [
    'process.stdin.setEncoding("utf8");',
    'process.stdout.write(`tty:${process.stdin.isTTY === true}\\n`);',
    'let data = "";',
    'process.stdin.on("data", (chunk) => {',
    '  data += chunk;',
    '  const lineEnd = data.indexOf("\\n");',
    '  if (lineEnd === -1) return;',
    '  const line = data.slice(0, lineEnd).replace(/\\r/g, "");',
    `  process.stdout.write(${JSON.stringify(`${prefix}:`)} + line + "\\n");`,
    '  process.exit(0);',
    '});',
    'setTimeout(() => process.exit(2), 4000);',
  ].join('\n');
}

function persistentOutputScript(label: string): string {
  return [
    `process.stdout.write(${JSON.stringify(`ready:${label}\n`)});`,
    'process.on("SIGTERM", () => process.exit(143));',
    'process.on("SIGINT", () => process.exit(130));',
    'setInterval(() => {}, 1000);',
    'setTimeout(() => process.exit(2), 15000);',
  ].join('\n');
}

async function createOpenAiCaptureServer(responseText = 'Captured.'): Promise<{
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
      if (responseText) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: responseText } }] })}\n\n`);
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

async function createOpenAiDynamicToolServer(): Promise<{
  baseUrl: string;
  requests: Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}> {
  const requests: Record<string, unknown>[] = [];
  let resolveRequests: (requests: Record<string, unknown>[]) => void = () => undefined;
  let rejectRequests: (error: unknown) => void = () => undefined;
  const requestsPromise = new Promise<Record<string, unknown>[]>((resolve, reject) => {
    resolveRequests = resolve;
    rejectRequests = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = JSON.parse(await readRequestText(request)) as Record<string, unknown>;
      requests.push(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      if (requests.length === 1) {
        response.write(`data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_dynamic_1',
                    type: 'function',
                    function: {
                      name: 'tickets__lookup_ticket',
                      arguments: '{"id":"ABC-123"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })}\n\n`);
      } else {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Dynamic tool result received.' } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        resolveRequests([...requests]);
      }
      response.write('data: [DONE]\n\n');
      response.end();
    } catch (error) {
      rejectRequests(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for dynamic tool server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: requestsPromise,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function createOpenAiDeferredDynamicToolServer(): Promise<{
  baseUrl: string;
  requests: Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}> {
  const requests: Record<string, unknown>[] = [];
  let resolveRequests: (requests: Record<string, unknown>[]) => void = () => undefined;
  let rejectRequests: (error: unknown) => void = () => undefined;
  const requestsPromise = new Promise<Record<string, unknown>[]>((resolve, reject) => {
    resolveRequests = resolve;
    rejectRequests = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = JSON.parse(await readRequestText(request)) as Record<string, unknown>;
      requests.push(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      if (requests.length === 1) {
        writeOpenAiToolCallChunk(response, {
          id: 'call_tool_search_1',
          name: 'tool_search',
          argumentsText: '{"query":"lookup_ticket"}',
        });
      } else if (requests.length === 2) {
        writeOpenAiToolCallChunk(response, {
          id: 'call_deferred_dynamic_1',
          name: 'tickets__lookup_ticket',
          argumentsText: '{"id":"ABC-123"}',
        });
      } else {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Deferred dynamic tool result received.' } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        resolveRequests([...requests]);
      }
      response.write('data: [DONE]\n\n');
      response.end();
    } catch (error) {
      rejectRequests(error);
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for deferred dynamic tool server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: requestsPromise,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function writeOpenAiToolCallChunk(
  response: { write(chunk: string): unknown },
  toolCall: { id: string; name: string; argumentsText: string },
): void {
  response.write(`data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: toolCall.argumentsText,
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  })}\n\n`);
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

async function createMcpToolsServer(): Promise<{
  baseUrl: string;
  requests: Promise<Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }>>;
  close(): Promise<void>;
}> {
  const requests: Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }> = [];
  let resolveRequests: (requests: Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }>) => void = () => undefined;
  const requestsPromise = new Promise<Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }>>((resolve) => {
    resolveRequests = resolve;
  });
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestText(request)) as {
      method?: string;
      params?: { name?: string; uri?: string; arguments?: { query?: string } };
    };
    requests.push({
      method: body.method,
      authorization: request.headers.authorization,
      session: String(request.headers['mcp-session-id'] ?? ''),
      ...(request.headers['x-account'] ? { account: String(request.headers['x-account']) } : {}),
      ...(request.headers['x-static'] ? { staticHeader: String(request.headers['x-static']) } : {}),
      ...(body.method === 'resources/read' ? { uri: body.params?.uri } : {}),
      ...(body.method === 'tools/call' ? { tool: body.params?.name, query: body.params?.arguments?.query } : {}),
    });
    if (body.method === 'initialize') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'mcp-session-id': 'session_1' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'test-mcp', version: '1.0.0' },
        },
      }));
      return;
    }
    if (body.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (body.method === 'resources/list') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          resources: [
            {
              uri: 'memo://hello',
              name: 'hello',
              title: 'Hello Memo',
              description: 'A memo resource',
              mimeType: 'text/plain',
            },
          ],
        },
      }));
      resolveRequests(requests);
      return;
    }
    if (body.method === 'resources/templates/list') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          resourceTemplates: [
            {
              uriTemplate: 'memo://{id}',
              name: 'memo',
              title: 'Memo',
              description: 'Memo by id',
              mimeType: 'text/plain',
            },
          ],
        },
      }));
      resolveRequests(requests);
      return;
    }
    if (body.method === 'resources/read') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          contents: [
            {
              uri: body.params?.uri,
              mimeType: 'text/plain',
              text: `resource for ${body.params?.uri ?? ''}`,
            },
          ],
        },
      }));
      resolveRequests(requests);
      return;
    }
    if (body.method === 'tools/call') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: `result for ${body.params?.arguments?.query ?? ''}` }],
          structuredContent: { query: body.params?.arguments?.query, count: 1 },
          isError: false,
          _meta: { source: 'test-mcp' },
        },
      }));
      resolveRequests(requests);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          { name: 'summarize_page' },
          { name: 'search_web', description: 'Search the web' },
        ],
      },
    }));
    resolveRequests(requests);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for MCP tools server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: requestsPromise,
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
