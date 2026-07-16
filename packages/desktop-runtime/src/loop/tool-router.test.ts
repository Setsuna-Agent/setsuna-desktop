import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { RuntimeToolExecutionContext, ToolHost } from '../ports/tool-host.js';
import { RuntimeToolRouter } from './tool-router.js';

describe('RuntimeToolRouter', () => {
  it('matches Unicode terms in deferred tool descriptions', async () => {
    const revealed: string[] = [];
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      revealDeferredTools: (names) => revealed.push(...names),
      toolHost: unicodeToolHost(),
    });

    const input = { query: '实时新闻' };
    const result = await router.runToolCall({
      id: 'call_unicode_tool_search',
      name: 'tool_search',
      arguments: JSON.stringify(input),
    }, input);

    expect(result.status).toBe('success');
    expect(result.result?.data).toMatchObject({
      revealedToolNames: ['news_lookup'],
      tools: [expect.objectContaining({ name: 'news_lookup' })],
    });
    expect(revealed).toEqual(['news_lookup']);
  });
});

function unicodeToolHost(): ToolHost {
  const tools: RuntimeToolDefinition[] = [
    { name: 'direct_tool', description: 'Already available', inputSchema: { type: 'object' } },
    { name: 'news_lookup', description: '搜索实时新闻和网页内容', inputSchema: { type: 'object' } },
  ];
  return {
    listTools: async () => tools,
    toolRuntimeProfile: (name) => ({ exposure: name === 'news_lookup' ? 'deferred' : 'direct' }),
    runTool: async () => ({ content: 'unused' }),
  };
}

function runtimeToolContext(): RuntimeToolExecutionContext {
  return {
    environment: {
      id: 'temporary_workspace',
      cwd: '/workspace',
      workspaceRoot: '/workspace',
      workspaceRoots: ['/workspace'],
    },
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    signal: new AbortController().signal,
    threadId: 'thread_1',
    turnId: 'turn_1',
  };
}
