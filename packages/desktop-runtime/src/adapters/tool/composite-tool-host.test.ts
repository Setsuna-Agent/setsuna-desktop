import { describe, expect, it } from 'vitest';
import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolHost } from '../../ports/tool-host.js';
import { CompositeToolHost } from './composite-tool-host.js';

describe('CompositeToolHost', () => {
  it('includes prompt text only for hosts with advertised tools', async () => {
    const direct = promptHost('direct_tool', 'Direct tool policy');
    const secondary = promptHost('secondary_tool', 'Secondary tool policy');
    const host = new CompositeToolHost([direct, secondary]);
    const context: ToolExecutionContext = { threadId: 'thread_1' };

    await expect(host.systemPrompt(context, {
      tools: [{ name: 'direct_tool', description: 'Direct', inputSchema: {} }],
    })).resolves.toBe('Direct tool policy');
  });

  it('delegates runtime profiles without rediscovering tools after the initial listing', async () => {
    let listCalls = 0;
    const internal = promptHost('internal_tool', 'Internal tool policy', () => {
      listCalls += 1;
    });
    internal.toolRuntimeProfile = () => ({ exposure: 'hidden' });
    const host = new CompositeToolHost([internal]);
    const context: ToolExecutionContext = { threadId: 'thread_1' };

    await host.listTools(context);

    await expect(host.toolRuntimeProfile('internal_tool', context)).resolves.toEqual({ exposure: 'hidden' });
    expect(listCalls).toBe(1);
  });
});

function promptHost(name: string, prompt: string, onList?: () => void): ToolHost {
  const tool: RuntimeToolDefinition = { name, description: name, inputSchema: {} };
  return {
    listTools: async () => {
      onList?.();
      return [tool];
    },
    systemPrompt: () => prompt,
    runTool: async () => ({ content: 'ok' }),
  };
}
