import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderRuntimeConfig } from '@setsuna-desktop/feature-model-provider/contracts';
import { PiModelClient } from '../../../../features/model-provider/src/runtime/pi-model-client.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { CapturingToolHost, mkDataDir, TestConfigStore } from '../../support/agent-loop/shared.js';

describe('agent loop model stream recovery', () => {
  it('completes the same turn after reasoning interruption without rerunning a completed tool', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Recover interrupted sampling' });
    const provider = providerFixture();
    const providerState = { ...provider, apiKeySet: true, apiKeyPreview: '***' };
    const config = {
      ...await new TestConfigStore().getConfig(),
      activeProviderId: provider.id,
      providers: [providerState],
    };
    const bodies: string[] = [];
    const replies = [
      chunk({ tool_calls: [{
        index: 0, id: 'read-1', type: 'function',
        function: { name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
      }] }) + chunk({}, 'tool_calls'),
      chunk({ reasoning_content: 'Interrupted reasoning.' }),
      chunk({ content: 'I read the file.' }) + chunk({}, 'stop'),
    ];
    const fetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      bodies.push(String(init?.body));
      const reply = replies.shift();
      if (reply === undefined) throw new Error('Unexpected extra provider request');
      return new Response(reply, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const modelClient = new PiModelClient({
      appVersion: 'test',
      dataDir,
      fetchForRoute: () => fetch,
      readProviderState: async () => ({ activeProviderId: provider.id, providers: [providerState] }),
      resolveProvider: async () => provider,
      saveProviderState: async () => ({ activeProviderId: provider.id, providers: [providerState] }),
      writeClipboardText: async () => undefined,
    });
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore, modelClient, toolHost, ids,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      configStore: new TestConfigStore(config, provider),
    });

    await loop.sendTurn(thread.id, { input: 'Read README and summarize it.', thinking: true });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(bodies[2]).toBe(bodies[1]);
    expect(bodies[2]).toContain('file contents from tool');
    expect(bodies[2]).not.toContain('Interrupted reasoning.');
    expect(toolHost.calls).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'model.verification')).toHaveLength(1);
    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(saved?.messages.at(-1)).toMatchObject({ content: 'I read the file.', status: 'complete' });
    expect(saved?.turns?.at(-1)?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reasoning', content: 'Interrupted reasoning.', status: 'failed' }),
    ]));
  });
});

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

function providerFixture(): ModelProviderRuntimeConfig {
  const activeModel = {
    id: 'model', name: 'Model', code: 'model-code', enabled: true,
    maxOutputTokens: 4_096, thinkingEnabled: true, thinkingEfforts: ['high'],
  };
  return {
    id: 'provider', name: 'Provider', provider: 'openai-compatible',
    baseUrl: 'https://provider.test/v1', apiKey: 'test-key', enabled: true,
    models: [activeModel], activeModel,
  };
}
