import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { createRuntimeToolHookRunner } from '../../../src/hooks/runtime-hooks.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  hookContext,
  hookEnvironment,
  hookEventCapture,
  StopHookModelClient,
} from '../../support/agent-loop/hook-lifecycle.js';
import {
  CapturingToolHost,
  HooksConfigStore,
  mkDataDir,
  nodeEvalHook,
  ToolCallingModelClient
} from '../../support/agent-loop/shared.js';

describe('agent loop hook lifecycle', () => {
  it('runs SessionStart hooks before the first model request and injects context', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session start hook context', projectId: 'project_1' });
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
          SessionStart: [{
            matcher: 'startup',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'SessionStart' || payload.source !== 'startup') process.exit(1); process.stdout.write('session context from startup'); });"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const firstRequestText = modelClient.requests[0]?.messages.map((message) => message.content).join('\n');
  
      expect(firstRequestText).toContain('<hook_additional_context>');
      expect(firstRequestText).toContain('session context from startup');
      expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
        {
          eventName: 'SessionStart',
          matcher: 'startup',
          status: 'completed',
          message: 'Added context.',
          entries: [{ kind: 'context', text: 'session context from startup' }],
        },
      ]);
    });
  
  it('lets SessionStart hooks stop the turn before user prompt hooks and model calls', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session start hook stop', projectId: 'project_1' });
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
          SessionStart: [{
            matcher: 'startup',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ continue: false, stopReason: 'session start paused', hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'saved for later' } }));"),
              timeoutSec: 5,
            }],
          }],
          UserPromptSubmit: [{
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stderr.write('should not run'); process.exit(2);"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
  
      expect(modelClient.requests).toEqual([]);
      expect(toolHost.calls).toEqual([]);
      expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(saved?.messages.find((message) => message.role === 'assistant')?.content).toBe('session start paused');
      expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
        {
          eventName: 'SessionStart',
          status: 'stopped',
          message: 'session start paused',
          entries: [
            { kind: 'context', text: 'saved for later' },
            { kind: 'stop', text: 'session start paused' },
          ],
        },
      ]);
    });
  
  it('runs SessionStart clear hooks after clearing thread context through AgentLoop', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Session start clear hook', projectId: 'project_1' });
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: '2026-06-26T00:03:00.000Z',
        payload: {
          message: {
            id: 'clear_msg_1',
            role: 'user',
            content: 'old context',
            createdAt: '2026-06-26T00:03:00.000Z',
            status: 'complete',
          },
        },
      });
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
          SessionStart: [{
            matcher: 'clear',
            hooks: [{
              type: 'command',
              command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.source !== 'clear') process.exit(1); process.stdout.write('context after clear'); });"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      const cleared = await loop.clearThreadContext(thread.id);
      await loop.sendTurn(thread.id, { input: 'read README after clear' });
      const firstRequestText = modelClient.requests[0]?.messages.map((message) => message.content).join('\n');
  
      expect(cleared.messages).toEqual([]);
      expect(firstRequestText).toContain('<hook_additional_context>');
      expect(firstRequestText).toContain('context after clear');
      expect(firstRequestText).not.toContain('old context');
    });
  
  it('runs SubagentStart hooks with agent metadata and ignores continue false', async () => {
      const config = await new HooksConfigStore({
        SubagentStart: [{
          matcher: 'worker',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'SubagentStart' || payload.agent_id !== 'agent_child' || payload.agent_type !== 'worker' || payload.permission_mode !== 'on-request') process.exit(1); process.stdout.write(JSON.stringify({ continue: false, stopReason: 'ignored for subagent start', hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'child startup context' } })); });"),
            timeoutSec: 5,
          }],
        }],
      }).getConfig();
      const runner = createRuntimeToolHookRunner(config);
      const events = hookEventCapture();
  
      const outcome = await runner?.runSubagentStart({
        agentId: 'agent_child',
        agentType: 'worker',
        approvalPolicy: 'on-request',
        context: hookContext(),
        environment: hookEnvironment(),
        events,
      });
  
      expect(outcome).toEqual({ additionalContexts: ['child startup context'] });
      expect(events.completed).toMatchObject([
        {
          eventName: 'SubagentStart',
          status: 'completed',
          message: 'Added context.',
          entries: [{ kind: 'context', text: 'child startup context' }],
        },
      ]);
    });
  
  it('runs SubagentStop hooks with agent metadata and blocks continuation', async () => {
      const config = await new HooksConfigStore({
        SubagentStop: [{
          matcher: 'worker',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'SubagentStop' || payload.agent_id !== 'agent_child' || payload.agent_type !== 'worker' || payload.agent_transcript_path !== '/tmp/agent.jsonl' || payload.last_assistant_message !== 'done') process.exit(1); process.stdout.write(JSON.stringify({ decision: 'block', reason: 'send summary to parent first' })); });"),
            timeoutSec: 5,
          }],
        }],
      }).getConfig();
      const runner = createRuntimeToolHookRunner(config);
      const events = hookEventCapture();
  
      const outcome = await runner?.runSubagentStop({
        agentId: 'agent_child',
        agentTranscriptPath: '/tmp/agent.jsonl',
        agentType: 'worker',
        approvalPolicy: 'on-request',
        context: hookContext(),
        environment: hookEnvironment(),
        events,
        lastAssistantMessage: 'done',
        stopHookActive: false,
      });
  
      expect(outcome).toEqual({
        blockReason: 'send summary to parent first',
        shouldBlock: true,
        shouldStop: false,
      });
      expect(events.completed).toMatchObject([
        {
          eventName: 'SubagentStop',
          status: 'blocked',
          message: 'send summary to parent first',
          entries: [{ kind: 'feedback', text: 'send summary to parent first' }],
        },
      ]);
    });
  
  it('runs UserPromptSubmit hooks and stops the turn before model calls', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'User prompt hook block', projectId: 'project_1' });
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
          UserPromptSubmit: [{
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stderr.write('prompt blocked by hook'); process.exit(2);"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(modelClient.requests).toEqual([]);
      expect(toolHost.calls).toEqual([]);
      expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(saved?.messages.find((message) => message.role === 'assistant')?.content).toBe('prompt blocked by hook');
      expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
        {
          eventName: 'UserPromptSubmit',
          status: 'blocked',
          message: 'prompt blocked by hook',
          entries: [{ kind: 'feedback', text: 'prompt blocked by hook' }],
        },
      ]);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'turn.completed',
        payload: expect.objectContaining({ taskKind: 'regular' }),
      }));
    });
  
  it('injects UserPromptSubmit additional context into the next model request', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'User prompt hook context', projectId: 'project_1' });
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
          UserPromptSubmit: [{
            hooks: [{
              type: 'command',
              command: nodeEvalHook("process.stdout.write(JSON.stringify({ systemMessage: 'hook warning', hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'prefer compact answers' } }));"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'read README' });
      const saved = await threadStore.getThread(thread.id);
      const firstRequestText = modelClient.requests[0]?.messages.map((message) => message.content).join('\n');
  
      expect(firstRequestText).toContain('<hook_additional_context>');
      expect(firstRequestText).toContain('prefer compact answers');
      expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
        {
          eventName: 'UserPromptSubmit',
          status: 'completed',
          message: 'Added context.',
          entries: [
            { kind: 'warning', text: 'hook warning' },
            { kind: 'context', text: 'prefer compact answers' },
          ],
        },
      ]);
    });
  
  it('runs Stop hooks and continues the turn when they block stopping', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Stop hook continuation', projectId: 'project_1' });
      const modelClient = new StopHookModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        configStore: new HooksConfigStore({
          Stop: [{
            hooks: [{
              type: 'command',
              command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (!payload.stop_hook_active) { process.stderr.write('continue with test coverage'); process.exit(2); } process.exit(0); });"),
              timeoutSec: 5,
            }],
          }],
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'finish the task' });
      const saved = await threadStore.getThread(thread.id);
      const userMessage = saved?.messages.find((message) => message.role === 'user');
      const assistantMessages = saved?.messages.filter((message) => message.role === 'assistant') ?? [];
      const secondRequestText = modelClient.requests[1]?.messages.map((message) => message.content).join('\n');
  
      expect(modelClient.requests).toHaveLength(2);
      expect(secondRequestText).toContain('<hook_stop_continuation>');
      expect(secondRequestText).toContain('continue with test coverage');
      expect(assistantMessages.map((message) => message.content)).toEqual(['first answer', 'final answer']);
      expect(userMessage?.hookRuns).toMatchObject([
        {
          eventName: 'Stop',
          status: 'blocked',
          message: 'continue with test coverage',
          entries: [{ kind: 'feedback', text: 'continue with test coverage' }],
        },
        {
          eventName: 'Stop',
          status: 'completed',
        },
      ]);
    });
});
