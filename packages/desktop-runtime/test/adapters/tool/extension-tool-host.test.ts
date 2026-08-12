import { describe, expect, it, vi } from 'vitest';
import { ExtensionToolHost } from '../../../src/adapters/tool/extension-tool-host.js';
import type { ExtensionRuntime } from '../../../src/ports/extension-runtime.js';

describe('extension tool host', () => {
  it('attributes dynamic tools and requires approval for unsandboxed execution', async () => {
    const runTool = vi.fn(async () => ({ content: 'extension result' }));
    const extensions = {
      listTools: vi.fn(async () => [{
        name: 'extension__demo__echo',
        localName: 'echo',
        description: 'Demo: echo',
        inputSchema: { type: 'object' },
        plugin: { id: 'demo', name: 'Demo' },
        execution: {
          supportsParallel: false,
          requiresApproval: true,
          requiresSandboxBypassApproval: true,
        },
      }]),
      runTool,
    } as unknown as ExtensionRuntime;
    const host = new ExtensionToolHost(extensions);
    const context = { threadId: 'thread_1', turnId: 'turn_1', toolCallId: 'call_1' };

    await expect(host.listTools(context)).resolves.toEqual([{
      name: 'extension__demo__echo',
      description: 'Demo: echo',
      inputSchema: { type: 'object' },
    }]);
    await expect(host.toolRuntimeProfile('extension__demo__echo', context)).resolves.toMatchObject({
      exposure: 'direct',
      plugin: { id: 'demo', name: 'Demo' },
      supportsParallel: false,
      waitsForRuntimeCancellation: true,
      approvalMode: 'orchestrated',
      requiresSandboxBypassApproval: true,
    });
    await expect(host.approvalForTool('extension__demo__echo', {}, context)).resolves.toMatchObject({
      approvalKeys: ['extension:demo:echo'],
      persistentApprovalKeys: ['extension:demo:echo'],
    });
    await expect(host.runTool('extension__demo__echo', { value: 1 }, context)).resolves.toEqual({
      content: 'extension result',
    });
    expect(runTool).toHaveBeenCalledWith('extension__demo__echo', { value: 1 }, context);
  });

  it('uses trusted marketplace execution hints without adding an approval', async () => {
    const extensions = {
      listTools: vi.fn(async () => [{
        name: 'web_search',
        localName: 'web_search',
        description: 'Search the web.',
        inputSchema: { type: 'object' },
        plugin: { id: 'web-search', name: '网络搜索' },
        execution: {
          supportsParallel: true,
          requiresApproval: false,
          requiresSandboxBypassApproval: false,
        },
      }]),
      runTool: vi.fn(async () => ({ content: 'search result' })),
    } as unknown as ExtensionRuntime;
    const host = new ExtensionToolHost(extensions);
    const context = { threadId: 'thread_1' };

    await host.listTools(context);
    await expect(host.toolRuntimeProfile('web_search', context)).resolves.toMatchObject({
      supportsParallel: true,
      requiresSandboxBypassApproval: false,
      plugin: { id: 'web-search' },
    });
    await expect(host.approvalForTool('web_search', {}, context)).resolves.toBeNull();
  });
});
