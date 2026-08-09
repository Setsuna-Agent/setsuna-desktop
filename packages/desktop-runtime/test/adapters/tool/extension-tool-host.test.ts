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
});
