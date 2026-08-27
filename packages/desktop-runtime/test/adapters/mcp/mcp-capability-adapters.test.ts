import type {
  McpRuntimeToolService,
  McpToolExecutionContext,
  McpToolRunContext,
} from '@setsuna-desktop/feature-mcp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BindableMcpControl } from '../../../src/adapters/mcp/bindable-mcp-control.js';
import { McpToolHostAdapter } from '../../../src/adapters/mcp/mcp-tool-host-adapter.js';

describe('MCP capability adapters', () => {
  it('fails closed before control binding while lifecycle cleanup remains safe', async () => {
    const control = new BindableMcpControl();

    await expect(control.listServers()).rejects.toThrow('MCP feature is not active');
    await expect(control.invalidateServer('docs')).resolves.toBeUndefined();
    await expect(control.releaseThread('thread_1')).resolves.toBeUndefined();
  });

  it('reuses one converted context and forwards MCP progress to tool output', async () => {
    const seenContexts: Array<McpToolExecutionContext | McpToolRunContext> = [];
    const service: McpRuntimeToolService = {
      listTools: vi.fn(async (context) => {
        seenContexts.push(context);
        return [{ name: 'mcp__docs__search', description: 'Search', inputSchema: { type: 'object' } }];
      }),
      toolRuntimeProfile: () => ({ exposure: 'deferred' }),
      systemPrompt: () => null,
      externalContext: async () => [],
      approvalForTool: async () => null,
      previewToolCall: vi.fn(async (_name, _input, context) => {
        seenContexts.push(context);
        return { resultPreview: 'search' };
      }),
      runTool: vi.fn(async (_name, _input, context) => {
        seenContexts.push(context);
        context.onProgress?.({ progress: 1, total: 2, message: 'loading' });
        return { content: 'done' };
      }),
    };
    const output = vi.fn();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      onToolOutputDelta: output,
    };
    const adapter = new McpToolHostAdapter();
    const unbind = adapter.bind(service);

    await adapter.listTools(context);
    await adapter.previewToolCall('mcp__docs__search', {}, context);
    await expect(adapter.runTool('mcp__docs__search', {}, context)).resolves.toEqual({ content: 'done' });
    expect(seenContexts).toHaveLength(3);
    expect(seenContexts[1]).toBe(seenContexts[0]);
    expect(seenContexts[2]).toBe(seenContexts[0]);
    expect(output).toHaveBeenCalledWith({ delta: 'loading 1/2\n' });

    unbind();
    await expect(adapter.listTools(context)).resolves.toEqual([]);
  });
});
