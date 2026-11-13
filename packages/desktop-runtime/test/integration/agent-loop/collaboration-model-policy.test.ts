import type { ModelRequest, ModelStreamEvent, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { defaultCollaborationAgentSettings, type CollaborationAgentSettings } from '@setsuna-desktop/feature-collaboration/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { bindTestCollaborationFeature, MultiAgentConfigStore } from '../../support/agent-loop/collaboration.js';
import { mkDataDir, TestConfigStore } from '../../support/agent-loop/shared.js';

describe('collaboration model authorization at dispatch', () => {
  it.each([
    { selection: 'parent', global: null, worker: null, listed: ['parent'] },
    { selection: 'global', global: 'global', worker: null, listed: ['global'] },
    { selection: 'worker', global: 'global', worker: 'worker', listed: ['global', 'worker'] },
  ])('uses the user-authorized $selection model and rejects other catalog models before starting a child', async ({ selection, global, worker, listed }) => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const model = (modelId: string) => ({ providerId: 'provider', modelId });
    const config: RuntimeConfigState = { ...await new MultiAgentConfigStore().getConfig(), activeProviderId: 'other-provider', providers: [
      {
        id: 'provider', name: 'Provider', provider: 'openai-responses', baseUrl: 'https://example.test/v1', enabled: true, apiKeySet: true, apiKeyPreview: '***',
        models: ['unapproved', 'parent', 'global', 'worker'].map((id) => ({
          id, name: id, code: `${id}-code`, enabled: true, maxOutputTokens: 4096,
          thinkingEnabled: true, thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'low',
        })),
      },
      {
        id: 'other-provider', name: 'Other provider', provider: 'openai-responses', baseUrl: 'https://other.example.test/v1', enabled: true, apiKeySet: true, apiKeyPreview: '***',
        models: [{ id: selection, name: selection, code: `${selection}-code`, enabled: true, maxOutputTokens: 4096, thinkingEnabled: false, thinkingEfforts: [] }],
      },
    ] };
    const settings: CollaborationAgentSettings = {
      ...defaultCollaborationAgentSettings(), model: global ? model(global) : null,
      roles: defaultCollaborationAgentSettings().roles.map((role) => role.name === 'worker' && worker ? { ...role, model: model(worker) } : role),
    };
    const requests: ModelRequest[] = [];
    const loop = new AgentLoop({ threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(), configStore: new TestConfigStore(config),
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        requests.push(request);
        if (request.messages.some((message) => message.inputKind === 'subagent_task' || message.toolName === 'spawn_agent')) {
          yield { type: 'text_delta', text: 'Finished.' };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        const toolCalls = request.messages.some((message) => message.toolName === 'list_agent_profiles')
          ? [
              { id: 'explicit', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Explicit allowed', role: 'worker', model: model(selection), reasoning_effort: 'low' }) },
              { id: 'inherited', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Inherit allowed', role: 'worker' }) },
              { id: 'null-model', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Null must not bypass settings', role: 'worker', model: null, reasoning_effort: 'none' }) },
              { id: 'forbidden', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Unauthorized', role: 'worker', model: model('unapproved') }) },
              { id: 'other-provider', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Wrong provider', role: 'worker', model: { providerId: 'other-provider', modelId: selection } }) },
              { id: 'bad-effort', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Unsupported effort', role: 'worker', reasoning_effort: 'unsupported' }) },
            ]
          : [{ id: 'profiles', name: 'list_agent_profiles', arguments: '{}' }];
        yield { type: 'tool_calls', toolCalls };
        yield { type: 'done', finishReason: 'tool_calls' };
      } },
    });
    const control = bindTestCollaborationFeature(loop, store, async () => settings);
    try {
      const parent = await store.createThread({ title: 'Model authorization' });
      // The selected conversation model must win over both the active provider and catalog order.
      await loop.sendTurn(parent.id, { input: 'Delegate the checks.', modelSelection: model('parent'), thinking: true, thinkingEffort: 'high' });
      const children = await store.listThreads({ parentThreadId: parent.id });
      expect(children).toHaveLength(3);
      const childThreads = await Promise.all(children.map((child) => store.getThread(child.id)));
      expect(childThreads.map((child) => child?.modelBinding)).toEqual(Array.from({ length: 3 }, () => ({
        ...model(selection), modelCode: `${selection}-code`,
      })));
      const childRequests = requests.filter((request) => request.messages.some((message) => message.inputKind === 'subagent_task'));
      expect(childRequests).toHaveLength(3);
      expect(childRequests.every((request) => request.providerId === 'provider' && request.model === `${selection}-code`)).toBe(true);
      expect(childRequests.map((request) => ({ thinking: request.thinking, effort: request.reasoningEffort }))).toEqual(expect.arrayContaining([
        { thinking: true, effort: 'low' }, { thinking: true, effort: 'high' }, { thinking: false, effort: undefined },
      ]));
      const completed = (await store.getThread(parent.id))!;
      for (const callId of ['forbidden', 'other-provider', 'bad-effort']) {
        expect(completed.messages.find((message) => message.role === 'tool' && message.toolCallId === callId)?.status).toBe('error');
      }
      const profiles = await control.execute('list_agent_profiles', {}, {
        threadId: parent.id, turnId: completed.turns!.at(-1)!.id, signal: new AbortController().signal,
      });
      expect(JSON.parse(profiles.content).availableModels.map((entry: { providerId: string; modelId: string }) => [entry.providerId, entry.modelId]))
        .toEqual(listed.map((id) => ['provider', id]));
      expect(JSON.parse(profiles.content).roles.find((role: { name: string }) => role.name === 'worker').model).toEqual(model(selection));

      if (selection === 'parent') {
        // A reused child cannot keep charging the previous model after the user switches the parent.
        await store.updateThread(parent.id, { modelBinding: { ...model('global'), modelCode: 'global-code' } });
        await loop.sendTurn(parent.id, { input: 'Continue with the newly selected model.', modelSelection: model('global') });
        const resumedParent = (await store.getThread(parent.id))!;
        await expect(control.execute('resume_agent', { thread_id: children[0]!.id, content: 'Continue old work' }, {
          threadId: parent.id, turnId: resumedParent.turns!.at(-1)!.id, signal: new AbortController().signal,
        })).rejects.toThrow('Agent model is restricted');
        expect(requests.filter((request) => request.messages.some((message) => message.inputKind === 'subagent_task'))).toHaveLength(3);
        expect((await control.readState(parent.id)).state.executions).toHaveLength(3);
      }
    } finally { await loop.shutdown(); await store.close(); }
  });
});
