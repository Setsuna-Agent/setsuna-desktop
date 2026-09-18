import { normalizeRuntimeProviderEndpoint, type RuntimeConfigState, type RuntimeMessage, type RuntimeMessageProviderMetadata } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { materializeRuntimeContextCompaction } from '../../../src/loop/context/context-compaction.js';
import { nativeCompactionMatchesModel, restoreNativeCompactionHistory } from '../../../src/loop/context/context-compaction-history.js';
import { ContextWindowConfigStore } from '../../support/agent-loop/shared.js';

describe('native compaction history', () => {
  it.each(['same', 'model', 'provider', 'endpoint', 'edited checkpoint'] as const)('restores source history only when replay is invalid: %s', async (change) => {
    const config = await nativeConfig();
    const original: RuntimeMessage = { id: 'original', role: 'user', content: 'Preserve this requirement.', createdAt: '2026-09-17T00:00:00.000Z' };
    const messages = checkpoint([original], 'checkpoint', config);
    const model = { providerId: 'test', model: 'local-runtime-smoke' };
    if (change === 'model') model.model = 'replacement-model';
    if (change === 'provider') config.providers[0]!.provider = 'openai-compatible';
    if (change === 'endpoint') config.providers[0]!.baseUrl = 'https://replacement.test/v1';
    if (change === 'edited checkpoint') messages.at(-1)!.content = 'Edited checkpoint';
    const restored = restoreNativeCompactionHistory(messages, (message) => nativeCompactionMatchesModel(message, config, model));
    expect(restored.filter((message) => message.visibility !== 'transcript').map((message) => message.id))
      .toEqual(change === 'same' ? ['checkpoint'] : ['original']);
    expect(messages[0]?.visibility).toBe('transcript');
  });

  it('expands repeated checkpoints in transcript order, preserving both sides of a tool transaction', async () => {
    const config = await nativeConfig();
    const originals: RuntimeMessage[] = [
      { id: 'user', role: 'user', content: 'Read the report and compare it.', createdAt: '2026-09-17T00:00:00.000Z' },
      { id: 'assistant', role: 'assistant', content: '', createdAt: '2026-09-17T00:00:01.000Z', toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{"path":"report.txt"}' }] },
      { id: 'tool', role: 'tool', content: 'Report result', createdAt: '2026-09-17T00:00:02.000Z', toolCallId: 'call_1' },
    ];
    const first = checkpoint(originals, 'first', config);
    const later: RuntimeMessage = { id: 'later', role: 'user', content: 'Continue the comparison.', createdAt: '2026-09-17T00:00:03.000Z' };
    const second = checkpoint([...first, later], 'second', config);
    const restored = restoreNativeCompactionHistory(second).filter((message) => message.visibility !== 'transcript');
    expect(restored).toEqual([...originals, later]);
    expect(() => restoreNativeCompactionHistory(second.filter((message) => message.id !== 'tool'))).toThrow('source message tool is unavailable');
  });
});

async function nativeConfig(): Promise<RuntimeConfigState> {
  const config = await new ContextWindowConfigStore(64_000).getConfig();
  config.providers[0]!.provider = 'openai-responses';
  return config;
}

function checkpoint(messages: RuntimeMessage[], id: string, config: RuntimeConfigState): RuntimeMessage[] {
  const provider = config.providers[0]!;
  const providerMetadata: RuntimeMessageProviderMetadata = {
    schemaVersion: 3,
    source: {
      providerId: provider.id, providerKind: 'openai-responses', model: provider.models[0]!.code,
      endpointFingerprint: createHash('sha256').update(normalizeRuntimeProviderEndpoint(provider.baseUrl)).digest('hex'),
    },
    openAiResponsesCompaction: { items: [{ type: 'compaction', encrypted_content: 'opaque-state' }] },
  };
  return materializeRuntimeContextCompaction({
    candidate: {
      autoCompactTokenLimit: 54_400, maxContextTokens: 64_000, maxContextTokensK: 64,
      historyTokens: 1_000, originalTokens: 1_000, reservedTokens: 0, targetContextTokens: 10_000,
      olderMessages: messages, pinnedMessages: [], recentMessages: [], triggerScopes: ['manual'],
    },
    id, createdAt: '2026-09-17T00:00:04.000Z', source: 'remote', summary: 'Provider native checkpoint', providerMetadata,
    nativeSourceMessageIds: messages.filter((message) => message.visibility !== 'transcript').map((message) => message.id),
  }).messages;
}
