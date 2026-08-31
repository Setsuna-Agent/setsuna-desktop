import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { CompositeToolHost } from '../../../src/adapters/tool/composite-tool-host.js';
import type { ToolExecutionContext, ToolHost } from '../../../src/ports/tool-host.js';

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
    internal.toolRuntimeProfile = () => ({ visibleToModel: false });
    const host = new CompositeToolHost([internal]);
    const context: ToolExecutionContext = { threadId: 'thread_1' };

    await host.listTools(context);

    await expect(host.toolRuntimeProfile('internal_tool', context)).resolves.toEqual({ visibleToModel: false });
    expect(listCalls).toBe(1);
  });

  it('rejects direct tool names that collide across hosts', async () => {
    const host = new CompositeToolHost([
      promptHost('shared_tool', 'First'),
      promptHost('shared_tool', 'Second'),
    ]);

    await expect(host.listTools({ threadId: 'thread_1' }))
      .rejects.toThrow('registered by multiple hosts: shared_tool');
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
