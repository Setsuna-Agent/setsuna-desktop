import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { CompositeToolHost } from '../../../src/adapters/tool/composite-tool-host.js';
import { UserInputToolHost } from '../../../src/adapters/tool/user-input-tool-host.js';
import { eventWorkerRequestContext } from '../../../src/extensions/extension-request-context.js';
import { ExtensionUiCoordinator } from '../../../src/extensions/extension-ui-coordinator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import type { ToolExecutionContext, ToolHost } from '../../../src/ports/tool-host.js';
import type { ExtensionEventContext } from '../../../src/ports/extension-runtime.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { mkDataDir, TestConfigStore, waitForTurnCompleted } from '../../support/agent-loop/shared.js';
import { bindTestCollaborationFeature, childThreadIdFromCollaborationToolMessages, hasToolMessage } from '../../support/agent-loop/collaboration.js';

describe('unattended turn execution', () => {
  it('keeps spawned and resumed children unattended under strict approval without granting write access', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const parent = await store.createThread({ title: 'Scheduled research' });
    const config = await new TestConfigStore().getConfig();
    config.approvalPolicy = 'strict'; config.permissionProfile = 'read-only';
    config.features = { multi_agent: true, default_mode_request_user_input: true };
    const configStore = new TestConfigStore(config);
    const approvals = new InMemoryApprovalGate(systemClock, ids);
    const events = new InMemoryEventBus();
    const writer = new RuntimeEventWriter(store, events);
    const executions: ToolExecutionContext[] = [];
    const toolHost: ToolHost = {
      listTools: async () => ['read_file', 'write_file'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
      runTool: vi.fn(async (_name, _input, context) => { executions.push(context); return { content: 'Research result' }; }),
    };
    const childRequests: ModelRequest[] = [];
    const model = {
      async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
        const child = request.messages.some((message) => message.inputKind === 'subagent_task' || message.content.includes('<mailbox_message'));
        if (child) {
          childRequests.push(request);
          const resumed = request.messages.some((message) => message.content.includes('<mailbox_message'));
          const callId = resumed ? 'resumed_read' : 'spawned_read';
          if (!request.messages.some((message) => message.role === 'tool' && message.toolCallId === callId)) {
            yield { type: 'tool_calls', toolCalls: [{ id: callId, name: 'read_file', arguments: '{"file_path":"README.md"}' }, { id: `${callId}_write`, name: 'write_file', arguments: '{"file_path":"report.txt","content":"unsafe"}' }] };
            yield { type: 'done', finishReason: 'tool_calls' };
            return;
          }
        } else {
          const childId = childThreadIdFromCollaborationToolMessages(request.messages);
          const toolCall = !childId
            ? { id: 'spawn', name: 'spawn_agent', arguments: '{"prompt":"Inspect README","title":"Research"}' }
            : !hasToolMessage(request.messages, 'wait')
              ? { id: 'wait_initial', name: 'wait', arguments: JSON.stringify({ thread_id: childId }) }
              : !hasToolMessage(request.messages, 'resume_agent')
                ? { id: 'resume', name: 'resume_agent', arguments: JSON.stringify({ thread_id: childId, content: 'Inspect again' }) }
                : !request.messages.some((message) => message.toolCallId === 'wait_resumed')
                  ? { id: 'wait_resumed', name: 'wait', arguments: JSON.stringify({ thread_id: childId }) }
                  : null;
          if (toolCall) {
            yield { type: 'tool_calls', toolCalls: [toolCall] };
            yield { type: 'done', finishReason: 'tool_calls' };
            return;
          }
        }
        yield { type: 'text_delta', text: 'Research complete' }; yield { type: 'done', finishReason: 'stop' };
      },
    };
    const loop = new AgentLoop({
      threadStore: store, eventBus: events, clock: systemClock, ids, modelClient: model,
      approvalGate: approvals, configStore,
      toolHost: new CompositeToolHost([toolHost, new UserInputToolHost(approvals, writer, systemClock, ids)]),
    });
    bindTestCollaborationFeature(loop, store);
    try {
      const started = await loop.startTurn(parent.id, { input: 'Research using a child.' }, { unattended: true });
      await waitForTurnCompleted(store, parent.id, started.turnId!);
      expect(executions).toHaveLength(2);
      expect(executions.every((context) => context.unattended && context.readOnly && context.permissionProfile === 'read-only')).toBe(true);
      expect(vi.mocked(toolHost.runTool).mock.calls.every(([name]) => name === 'read_file')).toBe(true);
      expect(childRequests).toHaveLength(4);
      expect(childRequests.every((request) => !request.tools?.some((tool) => tool.name === 'write_file' || tool.name === 'request_user_input'))).toBe(true);
      await expect(approvals.listApprovals()).resolves.toEqual({ approvals: [] });
      await expect(configStore.getConfig()).resolves.toMatchObject({ approvalPolicy: 'strict', permissionProfile: 'read-only' });
    } finally { await loop.shutdown(); }
  });

  it('keeps full access and excludes forms at every sampling step without changing ordinary chat settings', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const scheduled = await store.createThread({ title: 'Scheduled work' });
    const ordinary = await store.createThread({ title: 'Ordinary chat' });
    const config = await new TestConfigStore().getConfig();
    config.approvalPolicy = 'strict'; config.permissionProfile = 'read-only';
    config.features = { default_mode_request_user_input: true };
    const configStore = new TestConfigStore(config);
    const events = new InMemoryEventBus();
    const approvals = new InMemoryApprovalGate(systemClock, ids);
    const writer = new RuntimeEventWriter(store, events);
    const extensionUi = new ExtensionUiCoordinator(approvals, writer, systemClock, ids);
    const extensionEvents: Array<{ name: string; context: ExtensionEventContext }> = [];
    const executions: ToolExecutionContext[] = [];
    const writeTool: ToolHost = {
      listTools: async () => [{ name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } } }],
      runTool: async (_name, _input, context) => { executions.push(context); return { content: 'File written' }; },
    };
    const requests: ModelRequest[] = [];
    const model = {
      async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
        requests.push(request);
        if (requests.length <= 2) {
          yield { type: 'tool_calls', toolCalls: [{ id: `call_${requests.length}`, name: 'write_file', arguments: '{"file_path":"report.txt","content":"done"}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Done' }; yield { type: 'done', finishReason: 'stop' };
        }
      },
    };
    const loop = new AgentLoop({
      threadStore: store, eventBus: events, clock: systemClock, ids, modelClient: model,
      approvalGate: approvals, configStore,
      extensionManager: { async dispatch(name, context) {
        extensionEvents.push({ name, context });
        if (context.unattended) await expect(extensionUi.handle('ui.input', { message: 'Supply a value' }, eventWorkerRequestContext(context), { id: 'demo', name: 'Demo' })).rejects.toThrow('unattended');
        return {};
      } },
      toolHost: new CompositeToolHost([writeTool, new UserInputToolHost(approvals, writer, systemClock, ids)]),
    });
    try {
      const started = await loop.startTurn(scheduled.id, { input: 'Write the scheduled report.' }, { unattended: true });
      await waitForTurnCompleted(store, scheduled.id, started.turnId!);
      expect(executions).toHaveLength(2);
      expect(executions.every((context) => context.unattended && context.permissionProfile === 'danger-full-access' && context.features?.default_mode_request_user_input === false)).toBe(true);
      expect(requests.every((request) => !request.tools?.some((tool) => tool.name === 'request_user_input'))).toBe(true);
      expect((await store.listEvents(scheduled.id)).some((event) => event.type === 'approval.requested')).toBe(false);
      await expect(approvals.listApprovals()).resolves.toEqual({ approvals: [] });
      const scheduledHooks = extensionEvents.filter((event) => event.context.threadId === scheduled.id);
      expect(new Set(scheduledHooks.map((event) => event.name))).toEqual(new Set(['session.start', 'prompt.before', 'tool.before', 'tool.after', 'turn.settled']));
      expect(scheduledHooks.every((event) => event.context.unattended)).toBe(true);

      await loop.sendTurn(ordinary.id, { input: 'Answer normally.' });
      expect(requests.at(-1)?.tools?.some((tool) => tool.name === 'request_user_input')).toBe(true);
      expect(extensionEvents.filter((event) => event.context.threadId === ordinary.id).every((event) => !event.context.unattended)).toBe(true);
      await expect(configStore.getConfig()).resolves.toMatchObject({ approvalPolicy: 'strict', permissionProfile: 'read-only', features: { default_mode_request_user_input: true } });
    } finally { await loop.shutdown(); }
  });
});
