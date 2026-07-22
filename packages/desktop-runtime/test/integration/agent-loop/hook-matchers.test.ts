import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  CapturingToolHost,
  HooksConfigStore,
  mkDataDir,
  nodeEvalHook,
  ToolCallingModelClient
} from '../../support/agent-loop/shared.js';

describe('agent loop hook matching', () => {
  it('runs PreToolUse hooks and blocks denied tool calls', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook block', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: 'workspace_read_file',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stderr.write('blocked by policy'); process.exit(2);"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([]);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolName: 'workspace_read_file',
          status: 'rejected',
          content: expect.stringContaining('blocked by policy'),
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.started',
        payload: expect.objectContaining({
          eventName: 'PreToolUse',
          toolName: 'workspace_read_file',
          status: 'running',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PreToolUse',
          toolName: 'workspace_read_file',
          status: 'blocked',
          message: 'blocked by policy',
          entries: [{ kind: 'feedback', text: 'blocked by policy' }],
        }),
      }));
      const hookRun = saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns?.[0];
      expect(hookRun).toMatchObject({
        eventName: 'PreToolUse',
        status: 'blocked',
        message: 'blocked by policy',
        entries: [{ kind: 'feedback', text: 'blocked by policy' }],
      });
      expect(saved?.messages.find((message) => message.role === 'tool')?.content).toContain('blocked by policy');
    });
  
  it('treats star hook matchers as match-all like Codex', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook star matcher', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: '*',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stderr.write('blocked by star matcher'); process.exit(2);"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([]);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'hook.completed',
        payload: expect.objectContaining({
          eventName: 'PreToolUse',
          matcher: '*',
          status: 'blocked',
          message: 'blocked by star matcher',
        }),
      }));
    });
  
  it('uses exact matching for literal hook matchers instead of substring regex matching', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Hook literal matcher', projectId: 'project_1' });
      const modelClient = new ToolCallingModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
        configStore: new HooksConfigStore({
          PreToolUse: [{
            matcher: 'read',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stderr.write('literal read should not match workspace_read_file'); process.exit(2);"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
      expect(events.some((event) => event.type === 'hook.completed')).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolName: 'workspace_read_file',
          status: 'success',
        }),
      }));
    });
});
