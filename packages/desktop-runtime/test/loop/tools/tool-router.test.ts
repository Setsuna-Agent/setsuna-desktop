import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ToolOrchestrator } from '../../../src/loop/tools/tool-orchestrator.js';
import {
  READ_TOOL_RESULT_PAGE_BYTES,
  READ_TOOL_RESULT_TOOL_NAME,
  RuntimeToolRouter,
  TOOL_SEARCH_TOOL_NAME,
} from '../../../src/loop/tools/tool-router.js';
import type { ToolResultStore } from '../../../src/ports/tool-result-store.js';
import type { RuntimeToolExecutionContext, ToolHost } from '../../../src/ports/tool-host.js';

const RUNTIME_PROVIDED_NAMES = [TOOL_SEARCH_TOOL_NAME, READ_TOOL_RESULT_TOOL_NAME];

describe('RuntimeToolRouter', () => {
  it('advertises direct host tools plus the runtime-provided tools', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: directToolHost(),
    });

    expect(router.advertisedToolNames()).toEqual(['direct_tool', 'news_lookup', ...RUNTIME_PROVIDED_NAMES]);
    await expect(router.toolRuntimeMetadata()).resolves.toEqual([
      expect.objectContaining({ name: 'direct_tool', exposure: 'direct', source: 'host' }),
      expect.objectContaining({ name: 'news_lookup', exposure: 'direct', source: 'host' }),
      expect.objectContaining({ name: TOOL_SEARCH_TOOL_NAME, exposure: 'direct', source: 'host' }),
      expect.objectContaining({ name: READ_TOOL_RESULT_TOOL_NAME, exposure: 'direct', source: 'host' }),
    ]);
  });

  it('continues to exclude explicitly hidden tools', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: hiddenToolHost(),
    });

    expect(router.advertisedToolNames()).toEqual(['direct_tool', ...RUNTIME_PROVIDED_NAMES]);
  });

  it('keeps deferred tools out of the initial advertised set and reports them as deferred', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
    });

    expect(router.advertisedToolNames()).toEqual([
      'read_file',
      'recall_memory',
      ...RUNTIME_PROVIDED_NAMES,
    ]);
    expect(router.deferredCatalogSize()).toBe(3);
    expect(router.loadedDeferredToolNames()).toEqual([]);
    await expect(router.toolRuntimeMetadata()).resolves.toEqual([
      expect.objectContaining({ name: 'read_file', exposure: 'direct' }),
      expect.objectContaining({ name: 'recall_memory', exposure: 'direct' }),
      expect.objectContaining({ name: TOOL_SEARCH_TOOL_NAME, exposure: 'direct' }),
      expect.objectContaining({ name: READ_TOOL_RESULT_TOOL_NAME, exposure: 'direct' }),
    ]);
  });

  it('activates searched tools only for the next step and keeps the direct prefix stable', async () => {
    let activatedNames: string[] = [];
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
      onDeferredActivated: (names) => { activatedNames = names; },
    });
    const prefixBefore = router.advertisedToolNames().slice(0, 3).join('\0');

    const result = await router.runToolSearch('browser snapshot', undefined);
    expect(result).toContain('browser_snapshot');
    expect(router.loadedDeferredToolNames()).toEqual(['browser_snapshot']);

    // The router belongs to the request that called tool_search, so its
    // execution/advertising snapshot must not mutate in the same step.
    expect(router.advertisedToolNames().slice(0, 3).join('\0')).toBe(prefixBefore);
    expect(router.advertisedToolNames()).toEqual([
      'read_file',
      'recall_memory',
      ...RUNTIME_PROVIDED_NAMES,
    ]);
    expect(activatedNames).toEqual(['browser_snapshot']);

    const nextStepRouter = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
      loadedDeferredToolNames: activatedNames,
    });
    expect(nextStepRouter.advertisedToolNames()).toEqual([
      'read_file',
      'recall_memory',
      ...RUNTIME_PROVIDED_NAMES,
      'browser_snapshot',
    ]);

    // 连续搜索同一工具不会改变 loaded 集合。
    await router.runToolSearch('browser snapshot', undefined);
    expect(router.loadedDeferredToolNames()).toEqual(['browser_snapshot']);
  });

  it('seeds activation from a previous step of the same turn', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
      loadedDeferredToolNames: ['git_status', 'run_shell_command'],
    });

    expect(router.advertisedToolNames()).toEqual([
      'read_file',
      'recall_memory',
      ...RUNTIME_PROVIDED_NAMES,
      'run_shell_command',
      'git_status',
    ]);
  });

  it('rejects execution of deferred tools that were never activated', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
    });

    await expect(router.runToolCall({ id: 'call_1', name: 'run_shell_command', arguments: '{}' }, {}))
      .rejects.toThrow('was not advertised');
  });

  it('rejects a deferred tool in the search step and executes it from the next step', async () => {
    const runToolCall = vi.fn(async () => ({ content: 'done', processed: true, status: 'success' as const }));
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: { runToolCall } as unknown as ToolOrchestrator,
      toolHost: deferredToolHost(),
    });
    await router.runToolSearch('shell command', undefined);

    await expect(router.runToolCall({ id: 'call_same_step', name: 'run_shell_command', arguments: '{}' }, {}))
      .rejects.toThrow('was not advertised');

    const nextStepRouter = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: { runToolCall } as unknown as ToolOrchestrator,
      toolHost: deferredToolHost(),
      loadedDeferredToolNames: router.loadedDeferredToolNames(),
    });
    await nextStepRouter.runToolCall({ id: 'call_1', name: 'run_shell_command', arguments: '{}' }, {});

    expect(runToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run_shell_command' }),
      {},
      expect.objectContaining({ turnId: 'turn_1' }),
      'on-request',
      expect.objectContaining({ waitsForRuntimeCancellation: true }),
    );
  });

  it('does not expose write or shell tools through search in a read-only catalog', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
      allowTool: (tool) => tool.name === 'read_file' || tool.name === 'git_status',
    });

    expect(router.deferredCatalogSize()).toBe(1);
    const result = await router.runToolSearch('shell', undefined);
    expect(result).toContain('No deferred tools matched');
    expect(router.loadedDeferredToolNames()).toEqual([]);
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

  it('applies output token limits from profiles and name fallbacks', async () => {
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: deferredToolHost(),
    });

    await expect(router.modelOutputTokenLimitFor('read_file')).resolves.toBe(10_000);
    await expect(router.modelOutputTokenLimitFor('run_shell_command')).resolves.toBe(8_000);
    await expect(router.modelOutputTokenLimitFor('browser_snapshot')).resolves.toBe(4_000);
    await expect(router.modelOutputTokenLimitFor(READ_TOOL_RESULT_TOOL_NAME)).resolves.toBe(8_000);
  });

  it('lets an explicit profile output limit override a built-in name fallback', async () => {
    const host = deferredToolHost();
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

function deferredToolHost(): ToolHost {
  const tools: RuntimeToolDefinition[] = [
    { name: 'read_file', description: 'Read a UTF-8 text file.', inputSchema: { type: 'object' } },
    { name: 'recall_memory', description: 'Recall durable local memories.', inputSchema: { type: 'object' } },
    { name: 'browser_snapshot', description: 'Read visible page text and interactive elements.', inputSchema: { type: 'object' } },
    { name: 'run_shell_command', description: 'Run a foreground shell command.', inputSchema: { type: 'object' } },
    { name: 'git_status', description: 'Show Git status for the workspace.', inputSchema: { type: 'object' } },
  ];
  const deferred = new Set(['browser_snapshot', 'run_shell_command', 'git_status']);
  return {
    listTools: async () => tools,
    toolRuntimeProfile: (name) => deferred.has(name) ? { exposure: 'deferred' } : null,
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
