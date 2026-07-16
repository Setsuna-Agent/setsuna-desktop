import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { RuntimeToolExecutionContext, ToolHost } from '../ports/tool-host.js';
import { RuntimeToolRouter } from './tool-router.js';

describe('RuntimeToolRouter', () => {
  it('advertises every model-visible host tool directly', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: directToolHost(),
    });

    expect(router.advertisedToolNames()).toEqual(['direct_tool', 'news_lookup']);
    await expect(router.toolRuntimeMetadata()).resolves.toEqual([
      expect.objectContaining({ name: 'direct_tool', exposure: 'direct', source: 'host' }),
      expect.objectContaining({ name: 'news_lookup', exposure: 'direct', source: 'host' }),
    ]);
  });

  it('continues to exclude explicitly hidden tools', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: hiddenToolHost(),
    });

    expect(router.advertisedToolNames()).toEqual(['direct_tool']);
  });
});

function directToolHost(): ToolHost {
  const tools: RuntimeToolDefinition[] = [
    { name: 'direct_tool', description: 'Already available', inputSchema: { type: 'object' } },
    { name: 'news_lookup', description: '搜索实时新闻和网页内容', inputSchema: { type: 'object' } },
  ];
  return {
    listTools: async () => tools,
    runTool: async () => ({ content: 'unused' }),
  };
}

function hiddenToolHost(): ToolHost {
  return {
    listTools: async () => [
      { name: 'direct_tool', description: 'Visible', inputSchema: { type: 'object' } },
      { name: 'internal_tool', description: 'Internal only', inputSchema: { type: 'object' } },
    ],
    toolRuntimeProfile: (name) => ({ exposure: name === 'internal_tool' ? 'hidden' : 'direct' }),
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
