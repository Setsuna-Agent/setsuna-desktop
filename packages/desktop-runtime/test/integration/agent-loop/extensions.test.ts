import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ExtensionRuntime } from '../../../src/ports/extension-runtime.js';
import {
  CapturingToolHost,
  mkDataDir,
  ToolCallingModelClient,
} from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('agent loop extension lifecycle', () => {
  it('runs prompt and tool middleware in order and settles the completed turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Extension lifecycle', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const extensionManager: Pick<ExtensionRuntime, 'dispatch'> = {
      dispatch: vi.fn(async (eventName, context) => {
        switch (eventName) {
          case 'session.start':
            return { context: ['session extension context'] };
          case 'prompt.before':
            return { input: 'rewritten prompt', context: ['prompt extension context'] };
          case 'tool.before':
            return { input: { path: 'CHANGED.md' }, context: ['before tool extension context'] };
          case 'tool.after':
            return { feedback: 'after tool extension feedback', context: ['after tool extension context'] };
          case 'turn.settled':
            expect(context.payload).toMatchObject({ status: 'completed', content: 'I read the file.' });
            return {};
          default:
            return {};
        }
      }),
    };
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      extensionManager,
    });

    await loop.sendTurn(thread.id, { input: 'original prompt' });

    const firstRequest = modelClient.requests[0]?.messages.map((message) => message.content).join('\n') ?? '';
    const secondRequest = modelClient.requests[1]?.messages.map((message) => message.content).join('\n') ?? '';
    expect(firstRequest).toContain('rewritten prompt');
    expect(firstRequest).toContain('session extension context');
    expect(firstRequest).toContain('prompt extension context');
    expect(toolHost.calls).toEqual([{
      name: 'workspace_read_file',
      input: { path: 'CHANGED.md' },
      projectId: 'project_1',
    }]);
    expect(secondRequest).toContain('after tool extension feedback');
    expect(secondRequest).toContain('before tool extension context');
    expect(secondRequest).toContain('after tool extension context');
    expect(extensionManager.dispatch).toHaveBeenCalledWith('session.start', expect.objectContaining({
      payload: { source: 'startup' },
    }));
    expect(extensionManager.dispatch).toHaveBeenCalledWith('tool.before', expect.objectContaining({
      toolCallId: 'call_1',
    }));
    expect(extensionManager.dispatch).toHaveBeenCalledWith('tool.after', expect.objectContaining({
      toolCallId: 'call_1',
    }));
    expect(extensionManager.dispatch).toHaveBeenLastCalledWith('turn.settled', expect.any(Object));
  });
});
