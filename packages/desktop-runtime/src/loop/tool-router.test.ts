import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeToolExecutionContext, ToolHost } from '../ports/tool-host.js';
import type { ToolOrchestrator } from './tool-orchestrator.js';
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

  it('passes Plugin ownership from the tool profile into the execution lifecycle', async () => {
    const runToolCall = vi.fn(async () => ({ content: 'done', processed: true, status: 'success' as const }));
    const toolHost: ToolHost = {
      listTools: async () => [{ name: 'plugin_tool', description: 'Plugin tool', inputSchema: { type: 'object' } }],
      toolRuntimeProfile: () => ({
        exposure: 'direct',
        plugin: { id: 'demo-plugin', name: 'Demo Plugin', icon: 'demo' },
      }),
      runTool: async () => ({ content: 'unused' }),
    };
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: { runToolCall } as unknown as ToolOrchestrator,
      toolHost,
    });

    await router.runToolCall({ id: 'call_1', name: 'plugin_tool', arguments: '{}' }, {});

    expect(runToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'plugin_tool' }),
      {},
      expect.objectContaining({ turnId: 'turn_1' }),
      'on-request',
      expect.objectContaining({
        plugin: { id: 'demo-plugin', name: 'Demo Plugin', icon: 'demo' },
      }),
    );
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
