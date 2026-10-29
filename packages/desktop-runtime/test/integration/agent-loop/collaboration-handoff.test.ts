import type { ModelRequest, ModelStreamEvent, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { defaultCollaborationAgentSettings } from '@setsuna-desktop/feature-collaboration/contracts';
import { describe, expect, it } from 'vitest';
import { FileAttachmentStore } from '../../../src/adapters/store/file-attachment-store.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { bindTestCollaborationFeature, MultiAgentConfigStore } from '../../support/agent-loop/collaboration.js';
import { mkDataDir, stepSnapshotSkillRegistry, TestConfigStore, waitForTurnCompleted } from '../../support/agent-loop/shared.js';

describe('collaboration configuration and handoff through SQLite and AgentLoop', () => {
  it('accepts real user steering during a child tool call and interrupts without losing partial results or blocking the parent', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const parent = await store.createThread({ title: 'Interrupt child safely' });
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    const loop = new AgentLoop({ threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(), configStore: new MultiAgentConfigStore(),
      toolHost: {
        listTools: async () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
        runTool: async (_name, _input, context) => {
          toolStarted();
          const signal = context.signal!;
          await new Promise<void>((_resolve, reject) => {
            const cancelled = () => reject(new DOMException('Interrupted', 'AbortError'));
            if (signal.aborted) cancelled();
            else signal.addEventListener('abort', cancelled, { once: true });
          });
          return { content: 'Unreachable' };
        },
      },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        if (request.messages.some((message) => message.inputKind === 'subagent_task')) {
          yield { type: 'text_delta', text: 'Initial findings before the read.' };
          yield { type: 'tool_calls', toolCalls: [{ id: 'read', name: 'read_file', arguments: '{}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else if (!request.messages.some((message) => message.toolName === 'spawn_agent')) {
          yield { type: 'tool_calls', toolCalls: [{ id: 'spawn', name: 'spawn_agent', arguments: '{"prompt":"Inspect the file"}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Integrated available findings.' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    const control = bindTestCollaborationFeature(loop, store);
    try {
      const parentTurn = await loop.startTurn(parent.id, { input: 'Inspect the file with a child.' });
      await started;
      const task = (await control.readState(parent.id)).state.tasks[0]!;
      const input = { threadId: parent.id, childThreadId: task.childThreadId, expectedTurnId: task.activeTurnId! };
      await control.act({ ...input, action: 'send', content: 'Please verify cancellation.' }, new AbortController().signal);
      const user = (await store.getThread(task.childThreadId))?.messages.find((message) => message.content === 'Please verify cancellation.');
      expect(user).toMatchObject({ role: 'user', turnId: task.activeTurnId });
      expect(user?.promptSource).toBeUndefined();
      await control.act({ ...input, action: 'interrupt' }, new AbortController().signal);
      await waitForTurnCompleted(store, parent.id, parentTurn.turnId!);
      expect((await control.readState(parent.id)).state.executions[0]).toMatchObject({ status: 'interrupted', delivery: 'delivered' });
      expect((await store.getThread(parent.id))?.messages.find((message) => message.id.startsWith('collaboration_result_'))?.content).toContain('Initial findings before the read.');
      expect(loop.activeTurnId(task.childThreadId)).toBeNull();
    } finally { await loop.shutdown(); await store.close(); }
  });

  it('applies per-child models and reasoning, retains attachment ownership and skills, and resumes with the original role and real user provenance', async () => {
    const root = await mkDataDir();
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(root, systemClock, ids);
    const attachments = new FileAttachmentStore(root, systemClock, ids);
    const asset = await attachments.create({ name: 'plan.txt', type: 'text/plain', data: new TextEncoder().encode('Check cleanup ownership.') });
    const config: RuntimeConfigState = { ...await new MultiAgentConfigStore().getConfig(), activeProviderId: 'provider', providers: [{
      id: 'provider', name: 'Provider', provider: 'openai-responses', baseUrl: 'https://example.test/v1', enabled: true, apiKeySet: true, apiKeyPreview: '***',
      models: ['parent', 'child'].map((id) => ({ id, name: id, code: `${id}-code`, enabled: true, maxOutputTokens: 4096, thinkingEnabled: true, thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'low' })),
    }] };
    const parent = await store.createThread({ title: 'Parent', modelBinding: { providerId: 'provider', modelId: 'parent', modelCode: 'parent-code' } });
    const requests: ModelRequest[] = [];
    let roleInstructions = 'Verify task ownership before changing cleanup.';
    const loop = new AgentLoop({ threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(),
      attachmentStore: attachments, configStore: new TestConfigStore(config), skillRegistry: stepSnapshotSkillRegistry(),
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        requests.push(request);
        if (!request.messages.some((message) => message.inputKind === 'subagent_task' || message.toolName === 'spawn_agent')) {
          yield { type: 'tool_calls', toolCalls: [
            { id: 'explicit', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Inspect plan', role: 'worker', model: { providerId: 'provider', modelId: 'child' }, reasoning_effort: 'low' }) },
            { id: 'inherited', name: 'spawn_agent', arguments: '{"prompt":"Inspect boundaries"}' },
          ] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Verified ownership.' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    const control = bindTestCollaborationFeature(loop, store, async () => {
      const settings = defaultCollaborationAgentSettings();
      return { ...settings, roles: settings.roles.map((role) => role.name === 'worker' ? { ...role, instructions: roleInstructions } : role) };
    });
    try {
      await loop.sendTurn(parent.id, { input: 'Inspect the attached plan. Do not publish.', attachments: [asset], skillIds: ['skill_step'], thinking: true, thinkingEffort: 'high' });
      const children = await store.listThreads({ parentThreadId: parent.id });
      expect(children).toHaveLength(2);
      const explicit = (await Promise.all(children.map((child) => store.getThread(child.id)))).find((child) => child?.modelBinding?.modelCode === 'child-code')!;
      const explicitRequest = requests.find((request) => request.model === 'child-code')!;
      expect(explicitRequest).toMatchObject({ providerId: 'provider', thinking: true, reasoningEffort: 'low' });
      expect(explicitRequest.messages.some((message) => message.role === 'developer' && message.content === roleInstructions)).toBe(true);
      expect(explicitRequest.messages.some((message) => message.content.includes('Use the step snapshot fixture.'))).toBe(true);
      expect(explicitRequest.messages.some((message) => message.promptSource === 'collaboration' && message.content.includes('Do not publish.'))).toBe(true);
      expect(requests.find((request) => request.model === 'parent-code' && request.messages.some((message) => message.inputKind === 'subagent_task'))).toMatchObject({ thinking: true, reasoningEffort: 'high' });
      expect((await store.getThread(explicit.id))?.messages.find((message) => message.inputKind === 'subagent_task')).toMatchObject({ attachments: [asset], skillIds: ['skill_step'] });
      expect(await attachments.resolveForThread(explicit.id, [asset])).toHaveLength(1);

      roleInstructions = 'Changed only for newly created agents.';
      const resumed = await control.act({ threadId: parent.id, childThreadId: explicit.id, action: 'resume', expectedTurnId: null, content: 'Verify cleanup once more.' }, new AbortController().signal);
      await waitForTurnCompleted(store, explicit.id, resumed.turnId!);
      const continued = requests.filter((request) => request.model === 'child-code').at(-1)!;
      expect(continued).toMatchObject({ thinking: true, reasoningEffort: 'low' });
      expect(continued.messages.some((message) => message.role === 'developer' && message.content === 'Verify task ownership before changing cleanup.')).toBe(true);
      expect(continued.messages.some((message) => message.content.includes('Use the step snapshot fixture.'))).toBe(true);
      const user = (await store.getThread(explicit.id))?.messages.find((message) => message.content === 'Verify cleanup once more.');
      expect(user?.role).toBe('user');
      expect(user?.promptSource).toBeUndefined();
      expect(user?.inputKind).toBeUndefined();
      await attachments.releaseThread(parent.id);
      expect(await attachments.resolveForThread(explicit.id, [asset])).toHaveLength(1);
      await expect(loop.collaborationRuntimeHost().retainAttachments('unknown', explicit.id, [asset])).rejects.toThrow('not owned');
      await expect(loop.collaborationRuntimeHost().resolveAgentConfiguration(parent, { role: 'default', instructions: '', model: null, reasoningEffort: 'unsupported' })).rejects.toThrow('does not support');
    } finally { await loop.shutdown(); await store.close(); }
  });
});
