import type { RuntimeRequestInput } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRuntimeClient } from '../../../../src/services/runtime-client/client.js';

describe('desktop runtime client advanced thread methods', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes parent and ancestor thread filters', async () => {
    const request = installRuntimeBridge(() => ({ threads: [] }));
    const client = createDesktopRuntimeClient();

    await client.listThreads({ ancestorThreadId: 'root thread', parentThreadId: 'parent/thread', includeArchived: true });

    expect(request).toHaveBeenCalledWith({
      path: '/v1/threads?includeArchived=true&ancestorThreadId=root+thread&parentThreadId=parent%2Fthread',
    });
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

  it('uses the app-server bridge for goals and returns the runtime goal', async () => {
    const request = installRuntimeBridge((input) => {
      const body = input.body as { method?: string } | undefined;
      if (body?.method === 'thread/goal/set') {
        return {
          id: 'thread/goal/set',
          result: {
            goal: {
              threadId: 'thread_1',
              objective: 'Ship it',
              status: 'active',
              tokenBudget: 1000,
              tokensUsed: 0,
              timeUsedSeconds: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        };
      }
      throw new Error(`unexpected request: ${input.path}`);
    });
    const client = createDesktopRuntimeClient();

    await expect(client.setThreadGoal('thread_1', { objective: 'Ship it', tokenBudget: 1000 })).resolves.toMatchObject({
      objective: 'Ship it',
      tokenBudget: 1000,
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/swe/app-server',
      method: 'POST',
      body: expect.objectContaining({ method: 'thread/goal/set', params: { threadId: 'thread_1', objective: 'Ship it', tokenBudget: 1000 } }),
    }));
  });

  it('unwraps MCP status and resource app-server responses', async () => {
    installRuntimeBridge((input) => {
      const body = input.body as { method?: string } | undefined;
      if (body?.method === 'mcpServerStatus/list') return { id: body.method, result: { data: [], nextCursor: null } };
      if (body?.method === 'mcpServer/resource/read') return { id: body.method, result: { contents: [{ text: 'hello' }] } };
      throw new Error(`unexpected request: ${input.path}`);
    });
    const client = createDesktopRuntimeClient();

    await expect(client.listMcpServerStatuses()).resolves.toEqual({ data: [], nextCursor: null });
    await expect(client.readMcpServerResource('thread_1', 'docs', 'memory://one')).resolves.toEqual({ contents: [{ text: 'hello' }] });
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
