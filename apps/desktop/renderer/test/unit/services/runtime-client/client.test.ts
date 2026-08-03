import type { RuntimeRequestInput } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRuntimeClient } from '../../../../src/services/runtime-client/client.js';

describe('desktop runtime client advanced thread methods', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the raw request bridge private to the renderer adapter', () => {
    installRuntimeBridge(() => ({}));

    const client = createDesktopRuntimeClient();

    expect(client).not.toHaveProperty('request');
  });

  it('forwards ordered event batches without expanding them into callback churn', () => {
    const batch = { events: [] };
    const unsubscribe = vi.fn();
    const startSse = vi.fn((
      _threadId: string,
      _sinceSeq: number | undefined,
      onBatch: (value: typeof batch) => void,
    ) => {
      onBatch(batch);
      return unsubscribe;
    });
    vi.stubGlobal('window', {
      setsunaDesktop: {
        runtime: {
          request: vi.fn(),
          startSse,
        },
      },
    });
    const client = createDesktopRuntimeClient();
    const onBatch = vi.fn();

    const stop = client.subscribeEvents('thread_1', 4, onBatch);

    expect(startSse).toHaveBeenCalledWith('thread_1', 4, onBatch);
    expect(onBatch).toHaveBeenCalledOnce();
    expect(onBatch).toHaveBeenCalledWith(batch);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('serializes parent and ancestor thread filters', async () => {
    const request = installRuntimeBridge(() => ({ threads: [] }));
    const client = createDesktopRuntimeClient();

    await client.listThreads({ ancestorThreadId: 'root thread', parentThreadId: 'parent/thread', includeArchived: true });

    expect(request).toHaveBeenCalledWith({
      path: '/v1/threads?includeArchived=true&ancestorThreadId=root+thread&parentThreadId=parent%2Fthread',
    });
  });

  it('routes queued turn input operations through encoded thread and input paths', async () => {
    const request = installRuntimeBridge(() => ({ accepted: true }));
    const client = createDesktopRuntimeClient();
    const queuedInput = {
      input: 'follow up',
      clientId: 'client_1',
      kind: 'plan' as const,
      skillIds: ['skill_1'],
      thinking: true,
      thinkingEffort: 'high',
    };

    await client.queueTurnInput('thread / 1', queuedInput);
    await client.retrieveQueuedTurnInput('thread / 1', 'input / 1');
    await client.releaseQueuedTurnInputEdit('thread / 1', 'input / 1', { editToken: 'edit_1' });
    await client.updateQueuedTurnInput('thread / 1', 'input / 1', {
      editToken: 'edit_2',
      input: 'edited follow up',
      attachments: [],
    });
    await client.deleteQueuedTurnInput('thread / 1', 'input / 1');
    await client.sendQueuedTurnInputNow('thread / 1', 'input / 1');

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs',
        method: 'POST',
        body: queuedInput,
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201/retrieve',
        method: 'POST',
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201/release',
        method: 'POST',
        body: { editToken: 'edit_1' },
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201',
        method: 'PATCH',
        body: {
          editToken: 'edit_2',
          input: 'edited follow up',
          attachments: [],
        },
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201',
        method: 'DELETE',
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201/send-now',
        method: 'POST',
      },
    ]);
  });

  it('lists and terminates thread-scoped background shell services through encoded paths', async () => {
    const request = installRuntimeBridge(() => ({ processes: [] }));
    const client = createDesktopRuntimeClient();

    await client.listBackgroundShellProcesses('thread / 1');
    await client.terminateBackgroundShellProcess('thread / 1', 'process / 1');

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      { path: '/v1/threads/thread%20%2F%201/background-shell-processes' },
      {
        path: '/v1/threads/thread%20%2F%201/background-shell-processes/process%20%2F%201',
        method: 'DELETE',
      },
    ]);
  });

  it('lists incremental developer traces through an encoded thread path', async () => {
    const request = installRuntimeBridge(() => ({ nextSeq: 8, traces: [] }));
    const client = createDesktopRuntimeClient();

    await client.listDebugTraces('thread / 1', 7.9);

    expect(request).toHaveBeenCalledWith({
      path: '/v1/threads/thread%20%2F%201/debug-traces?afterSeq=7',
    });
  });

  it('uses the binary bridge for uploads and the authenticated request bridge for pending deletes', async () => {
    const uploadAttachment = vi.fn(async () => ({
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime' as const,
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 3,
    }));
    const request = vi.fn(async () => ({ deleted: true }));
    vi.stubGlobal('window', {
      setsunaDesktop: {
        runtime: { request, uploadAttachment, startSse: vi.fn(() => vi.fn()) },
      },
    });
    const client = createDesktopRuntimeClient();
    const input = { name: 'guide.pdf', type: 'application/pdf', data: new Uint8Array([1, 2, 3]) };

    await expect(client.uploadAttachment(input)).resolves.toMatchObject({ assetId: 'attachment_1' });
    await expect(client.deleteAttachment('attachment / 1')).resolves.toEqual({ deleted: true });
    expect(uploadAttachment).toHaveBeenCalledWith(input);
    expect(request).toHaveBeenCalledWith({ path: '/v1/attachments/attachment%20%2F%201', method: 'DELETE' });
  });

  it('routes thread deletion, goals, and reviews through first-party REST', async () => {
    const request = installRuntimeBridge((input) => {
      if (input.method === 'PUT' && input.path.endsWith('/goal')) {
        return {
          threadId: 'thread / 1',
          objective: 'Ship it',
          status: 'active',
          tokenBudget: 1000,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        };
      }
      if (input.path.endsWith('/reviews')) {
        return { accepted: true, turnId: 'turn_review' };
      }
      if (input.path.endsWith('/goal')) {
        return { cleared: true };
      }
      return { ok: true };
    });
    const client = createDesktopRuntimeClient();
    const target = { type: 'baseBranch' as const, branch: 'main' };

    await client.deleteThread('thread / 1');
    await expect(client.setThreadGoal('thread / 1', {
      objective: 'Ship it',
      tokenBudget: 1000,
    })).resolves.toMatchObject({
      objective: 'Ship it',
      tokenBudget: 1000,
    });
    await expect(client.clearThreadGoal('thread / 1')).resolves.toBe(true);
    await expect(client.startReview('thread / 1', target)).resolves.toEqual({
      accepted: true,
      turnId: 'turn_review',
    });

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/threads/thread%20%2F%201',
        method: 'DELETE',
      },
      {
        path: '/v1/threads/thread%20%2F%201/goal',
        method: 'PUT',
        body: { objective: 'Ship it', tokenBudget: 1000 },
      },
      {
        path: '/v1/threads/thread%20%2F%201/goal',
        method: 'DELETE',
      },
      {
        path: '/v1/threads/thread%20%2F%201/reviews',
        method: 'POST',
        body: { target },
      },
    ]);
  });

  it('routes hooks, MCP operations, and skill roots through first-party REST', async () => {
    const request = installRuntimeBridge((input) => {
      if (input.path === '/v1/mcp/statuses') return { data: [], nextCursor: null };
      if (input.path === '/v1/mcp/resources/read') {
        return { contents: [{ text: 'hello' }] };
      }
      if (input.path === '/v1/mcp/tools/call') {
        return { content: [{ type: 'text', text: 'done' }], isError: false };
      }
      if (input.path.startsWith('/v1/hooks')) {
        return { data: [] };
      }
      return { ok: true };
    });
    const client = createDesktopRuntimeClient();

    await client.listHooks(['/repo one', '/repo/two']);
    await expect(client.listMcpServerStatuses()).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    await expect(
      client.readMcpServerResource('thread_1', 'docs', 'memory://one'),
    ).resolves.toEqual({
      contents: [{ text: 'hello' }],
    });
    await expect(
      client.callMcpServerTool('thread_1', 'docs', 'search', { q: 'setsuna' }),
    ).resolves.toMatchObject({
      isError: false,
    });
    await client.setSkillExtraRoots(['/skills/one']);

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/hooks?cwd=%2Frepo+one&cwd=%2Frepo%2Ftwo',
      },
      {
        path: '/v1/mcp/statuses',
      },
      {
        path: '/v1/mcp/resources/read',
        method: 'POST',
        body: { threadId: 'thread_1', server: 'docs', uri: 'memory://one' },
      },
      {
        path: '/v1/mcp/tools/call',
        method: 'POST',
        body: {
          threadId: 'thread_1',
          server: 'docs',
          tool: 'search',
          arguments: { q: 'setsuna' },
        },
      },
      {
        path: '/v1/skills/extra-roots',
        method: 'PUT',
        body: { extraRoots: ['/skills/one'] },
      },
    ]);
  });

  it('installs marketplace plugins by id without sending a local path', async () => {
    const request = installRuntimeBridge(() => ({ plugin: { id: 'openai-docs' } }));
    const client = createDesktopRuntimeClient();

    await client.installMarketplacePlugin('openai-docs');

    expect(request).toHaveBeenCalledWith({
      path: '/v1/plugin-marketplace/openai-docs/install',
      method: 'POST',
    });
  });

  it('updates marketplace plugins by id without sending a local path', async () => {
    const request = installRuntimeBridge(() => ({ plugin: { id: 'openai-docs', version: '2.0.0' } }));
    const client = createDesktopRuntimeClient();

    await client.updateMarketplacePlugin('openai docs');

    expect(request).toHaveBeenCalledWith({
      path: '/v1/plugin-marketplace/openai%20docs/update',
      method: 'POST',
    });
  });

  it('routes installed and marketplace plugin item previews through encoded, read-only paths', async () => {
    const request = installRuntimeBridge(() => ({ pluginId: 'documents', itemId: 'documents.documents', kind: 'skill', files: [] }));
    const client = createDesktopRuntimeClient();

    await client.getPluginItemContent('documents', 'skill', 'documents.documents');
    await client.getMarketplacePluginItemContent('documents', 'resource', 'sample document');

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      { path: '/v1/plugins/documents/items/skill/documents.documents' },
      { path: '/v1/plugin-marketplace/documents/items/resource/sample%20document' },
    ]);
  });

  it('routes workspace dependency status, toggle, diagnosis, and reinstall requests', async () => {
    const request = installRuntimeBridge(() => ({ enabled: false, state: 'disabled' }));
    const client = createDesktopRuntimeClient();

    await client.getWorkspaceDependencies();
    await client.setWorkspaceDependencies({ enabled: false });
    await client.diagnoseWorkspaceDependencies();
    await client.reinstallWorkspaceDependencies();

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      { path: '/v1/workspace-dependencies' },
      { path: '/v1/workspace-dependencies', method: 'PUT', body: { enabled: false } },
      { path: '/v1/workspace-dependencies/diagnose', method: 'POST' },
      { path: '/v1/workspace-dependencies/reinstall', method: 'POST' },
    ]);
  });

  it('sends only the prompt when testing the configured image generation plugin', async () => {
    const request = installRuntimeBridge(() => ({ images: [], durationMs: 12 }));
    const client = createDesktopRuntimeClient();

    await client.testImageGeneration({ prompt: 'a tiny moon' });

    expect(request).toHaveBeenCalledWith({
      path: '/v1/plugins/openai-image-generation/test',
      method: 'POST',
      body: { prompt: 'a tiny moon' },
    });
  });

  it('requests the workspace scoped to a conversation thread', async () => {
    const request = installRuntimeBridge(() => ({ exists: true, readable: true }));
    const client = createDesktopRuntimeClient();

    await client.getWorkspaceStatus({ threadId: 'thread / 1' });

    expect(request).toHaveBeenCalledWith({
      path: '/v1/workspace/status?threadId=thread+%2F+1',
    });
  });
});

function installRuntimeBridge(handler: (input: RuntimeRequestInput) => unknown) {
  const request = vi.fn(async (input: RuntimeRequestInput) => handler(input));
  vi.stubGlobal('window', {
    setsunaDesktop: {
      runtime: {
        request,
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  return request;
}
