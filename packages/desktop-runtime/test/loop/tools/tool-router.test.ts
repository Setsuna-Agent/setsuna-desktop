import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ToolOrchestrator } from '../../../src/loop/tools/tool-orchestrator.js';
import {
  READ_TOOL_RESULT_PAGE_BYTES,
  READ_TOOL_RESULT_TOOL_NAME,
  RuntimeToolRouter,
} from '../../../src/loop/tools/tool-router.js';
import type { ToolResultStore } from '../../../src/ports/tool-result-store.js';
import type { RuntimeToolExecutionContext, ToolHost } from '../../../src/ports/tool-host.js';

const RUNTIME_PROVIDED_NAMES = [READ_TOOL_RESULT_TOOL_NAME];

describe('RuntimeToolRouter', () => {
  it('advertises direct host tools plus the runtime-provided tools', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: directToolHost(),
    });

    expect(router.tools.map((tool) => tool.name)).toEqual(['direct_tool', 'news_lookup', ...RUNTIME_PROVIDED_NAMES]);
    await expect(router.toolRuntimeMetadata()).resolves.toEqual([
      expect.objectContaining({ name: 'direct_tool', source: 'host' }),
      expect.objectContaining({ name: 'news_lookup', source: 'host' }),
      expect.objectContaining({ name: READ_TOOL_RESULT_TOOL_NAME, source: 'host' }),
    ]);
  });

  it('continues to exclude explicitly hidden tools from routing', async () => {
    const runToolCall = vi.fn();
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: { runToolCall } as unknown as ToolOrchestrator,
      toolHost: hiddenToolHost(),
    });

    expect(router.tools.map((tool) => tool.name)).toEqual(['direct_tool', ...RUNTIME_PROVIDED_NAMES]);
    expect(router.canRouteTool('internal_tool')).toBe(false);
    await expect(router.runToolCall({ id: 'call_hidden', name: 'internal_tool', arguments: '{}' }, {}))
      .rejects.toThrow('is not registered in the allowed tool catalog');
    expect(runToolCall).not.toHaveBeenCalled();
  });

  it('advertises every visible host tool in catalog order', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: catalogToolHost(),
    });

    expect(router.tools.map((tool) => tool.name)).toEqual([
      'read_file',
      'recall_memory',
      'browser_snapshot',
      'run_shell_command',
      'git_status',
      ...RUNTIME_PROVIDED_NAMES,
    ]);
    await expect(router.toolRuntimeMetadata()).resolves.toEqual([
      expect.objectContaining({ name: 'read_file' }),
      expect.objectContaining({ name: 'recall_memory' }),
      expect.objectContaining({ name: 'browser_snapshot' }),
      expect.objectContaining({ name: 'run_shell_command' }),
      expect.objectContaining({ name: 'git_status' }),
      expect.objectContaining({ name: READ_TOOL_RESULT_TOOL_NAME }),
    ]);
  });

  it('routes an advertised host tool through the normal execution chain', async () => {
    const runToolCall = vi.fn(async () => ({ content: 'done', processed: true, status: 'success' as const }));
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: { runToolCall } as unknown as ToolOrchestrator,
      toolHost: catalogToolHost(),
    });

    expect(router.tools.map((tool) => tool.name)).toContain('run_shell_command');
    await router.runToolCall({ id: 'call_1', name: 'run_shell_command', arguments: '{}' }, {});

    expect(runToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run_shell_command' }),
      {},
      expect.objectContaining({ turnId: 'turn_1' }),
      'on-request',
      expect.objectContaining({ waitsForRuntimeCancellation: true }),
    );
  });

  it('exposes only allowed tools in a read-only catalog', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: catalogToolHost(),
      allowTool: (tool) => tool.name === 'read_file' || tool.name === 'git_status',
    });

    expect(router.tools.map((tool) => tool.name)).toEqual(['read_file', 'git_status', READ_TOOL_RESULT_TOOL_NAME]);
    expect(router.canRouteTool('run_shell_command')).toBe(false);
    expect(router.canRouteTool('git_status')).toBe(true);
  });

  it('reads tool results through the result store with thread authorization', async () => {
    const read = vi.fn(async () => ({
      content: 'page-content',
      nextOffset: 12 as number | null,
      totalBytes: 40,
    }));
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: directToolHost(),
      toolResultStore: { read } as unknown as ToolResultStore,
    });

    const output = await router.runReadToolResult({ result_id: 'tool_result_1', offset: 0 }, 'thread_1');
    expect(output).toContain('result_id: tool_result_1');
    expect(output).toContain('next_offset: 12');
    expect(output).toContain('page-content');
    expect(read).toHaveBeenCalledWith('thread_1', 'tool_result_1', 0, READ_TOOL_RESULT_PAGE_BYTES);
  });

  it('reports missing or unauthorized results and unavailable storage', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: directToolHost(),
    });
    await expect(router.runReadToolResult({ result_id: 'tool_result_1' }, 'thread_1'))
      .resolves.toContain('storage is unavailable');

    const routerWithStore = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: directToolHost(),
      toolResultStore: { read: async () => null } as unknown as ToolResultStore,
    });
    await expect(routerWithStore.runReadToolResult({ result_id: 'tool_result_1' }, 'thread_1'))
      .resolves.toContain('not found or is not authorized');
  });

  it('applies output token limits from profiles and generic name fallbacks', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: catalogToolHost(),
    });

    await expect(router.modelOutputTokenLimitFor('read_file')).resolves.toBe(10_000);
    await expect(router.modelOutputTokenLimitFor('run_shell_command')).resolves.toBe(8_000);
    await expect(router.modelOutputTokenLimitFor('browser_snapshot')).resolves.toBe(10_000);
    await expect(router.modelOutputTokenLimitFor(READ_TOOL_RESULT_TOOL_NAME)).resolves.toBe(8_000);
  });

  it('lets an explicit profile output limit override a built-in name fallback', async () => {
    const host = catalogToolHost();
    const baseProfile = host.toolRuntimeProfile;
    host.toolRuntimeProfile = async (name, context) => {
      const profile = await baseProfile?.(name, context);
      return {
        ...(profile ?? {}),
        ...(name === 'run_shell_command' ? { modelOutputTokenLimit: 1_234 } : {}),
      };
    };
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: host,
    });

    await expect(router.modelOutputTokenLimitFor('run_shell_command')).resolves.toBe(1_234);
  });

  it('passes Plugin ownership from the tool profile into the execution lifecycle', async () => {
    const runToolCall = vi.fn(async () => ({ content: 'done', processed: true, status: 'success' as const }));
    const toolHost: ToolHost = {
      listTools: async () => [{ name: 'plugin_tool', description: 'Plugin tool', inputSchema: { type: 'object' } }],
      toolRuntimeProfile: () => ({
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
    toolRuntimeProfile: (name) => name === 'internal_tool' ? { visibleToModel: false } : null,
    runTool: async () => ({ content: 'unused' }),
  };
}

function catalogToolHost(): ToolHost {
  const tools: RuntimeToolDefinition[] = [
    { name: 'read_file', description: 'Read a UTF-8 text file.', inputSchema: { type: 'object' } },
    { name: 'recall_memory', description: 'Recall durable local memories.', inputSchema: { type: 'object' } },
    { name: 'browser_snapshot', description: 'Read visible page text and interactive elements.', inputSchema: { type: 'object' } },
    { name: 'run_shell_command', description: 'Run a foreground shell command.', inputSchema: { type: 'object' } },
    { name: 'git_status', description: 'Show Git status for the workspace.', inputSchema: { type: 'object' } },
  ];
  return {
    listTools: async () => tools,
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
