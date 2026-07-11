import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeRequestInput } from '@setsuna-desktop/contracts';
import { createDesktopRuntimeClient } from './desktop-runtime-client.js';

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
