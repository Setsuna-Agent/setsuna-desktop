import type {
  ModelRequest,
  ProviderConfigState,
  RuntimeMessage,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ModelProviderRuntimeConfig } from '../../src/contracts/index.js';
import {
  createPiModel,
  createPiReplayContext,
  toPiContext,
} from '../../src/runtime/pi-context.js';

describe('Pi model context', () => {
  it('uses canonical Pi provider identities while retaining the Setsuna replay boundary', () => {
    const provider = providerFixture('setsuna-custom-openai', 'openai-responses');

    expect(createPiModel(provider, 'gpt-test')).toMatchObject({
      api: 'openai-responses',
      provider: 'openai',
    });
    expect(createPiReplayContext(provider, 'gpt-test')).toMatchObject({
      piProvider: 'openai',
      providerId: 'setsuna-custom-openai',
      providerKind: 'openai-responses',
    });
    expect(createPiModel({
      ...providerFixture('compatible', 'openai-compatible'),
      baseUrl: 'https://gateway.example/v1/chat/completions',
    }, 'gpt-test').baseUrl).toBe('https://gateway.example/v1');
  });

  it('retains Pi catalog provider identity and compatibility metadata for presets', () => {
    const provider = {
      ...providerFixture('provider-deepseek', 'openai-compatible'),
      catalogProviderId: 'deepseek',
      baseUrl: 'https://gateway.example/deepseek/v1',
    };
    const model = createPiModel({
      ...provider,
      activeModel: { ...provider.activeModel, code: 'deepseek-v4-flash' },
    }, 'deepseek-v4-flash');

    expect(model).toMatchObject({
      api: 'openai-completions',
      provider: 'deepseek',
      baseUrl: 'https://gateway.example/deepseek/v1',
    });
    expect(model.compat).toBeDefined();
    expect(createPiReplayContext({
      ...provider,
      activeModel: { ...provider.activeModel, code: 'deepseek-v4-flash' },
    }, 'deepseek-v4-flash').piProvider).toBe('deepseek');
  });

  it('inherits the selected Pi provider plan for synchronized models outside the static catalog', () => {
    const provider = {
      ...providerFixture('provider-deepseek', 'openai-compatible'),
      catalogProviderId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
    };
    const model = createPiModel({
      ...provider,
      activeModel: { ...provider.activeModel, code: 'deepseek-new-after-release' },
    }, 'deepseek-new-after-release');

    expect(model.provider).toBe('deepseek');
    expect(model.compat).toBeDefined();
  });

  it('does not inherit model-specific compatibility from an unrelated catalog model', () => {
    const provider = {
      ...providerFixture('provider-anthropic', 'anthropic'),
      catalogProviderId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    };
    const model = createPiModel({
      ...provider,
      activeModel: { ...provider.activeModel, code: 'claude-new-after-release' },
    }, 'claude-new-after-release');

    expect(model.provider).toBe('anthropic');
    expect(model.compat).not.toHaveProperty('allowedFallbackModels');
  });

  it('infers Pi catalog identity for legacy preset records without catalogProviderId', () => {
    const provider = {
      ...providerFixture('legacy-deepseek', 'openai-compatible'),
      baseUrl: 'https://api.deepseek.com',
    };
    const model = createPiModel({
      ...provider,
      activeModel: { ...provider.activeModel, code: 'deepseek-v4-flash' },
    }, 'deepseek-v4-flash');

    expect(model).toMatchObject({
      api: 'openai-completions',
      provider: 'deepseek',
    });
    expect(model.compat).toBeDefined();
  });

  it('does not infer Pi catalog identity for an explicitly custom service', () => {
    const provider = {
      ...providerFixture('custom-deepseek', 'openai-compatible'),
      catalogProviderId: null,
      baseUrl: 'https://api.deepseek.com',
    };
    const model = createPiModel({
      ...provider,
      activeModel: { ...provider.activeModel, code: 'deepseek-v4-flash' },
    }, 'deepseek-v4-flash');

    expect(model.provider).toBe('openai');
    expect(model.compat).toBeUndefined();
  });

  it('replays signed v3 blocks only inside the exact provider boundary', () => {
    const provider = providerFixture('provider-a', 'anthropic');
    const exact = createPiReplayContext(provider, 'claude-test');
    const unboundAssistant = messageFixture({
      content: 'Visible answer',
      providerMetadata: {
        schemaVersion: 3,
        source: {
          providerId: exact.providerId,
          providerKind: exact.providerKind,
          model: exact.model,
          endpointFingerprint: exact.endpointFingerprint,
        },
        assistantReplay: {
          blocks: [
            { type: 'thinking', text: 'private reasoning', signature: 'signed-state' },
            { type: 'text', text: 'Visible answer' },
          ],
        },
      },
      role: 'assistant',
      streamParts: [{ type: 'reasoning', content: 'portable reasoning' }],
    });

    const unboundMessage = toPiContext(requestFixture([unboundAssistant]), exact).messages[0];
    expect(unboundMessage).toMatchObject({
      content: [{ type: 'text', text: 'Visible answer' }],
    });
    expect(JSON.stringify(unboundMessage)).not.toContain('signed-state');

    const assistant = bindV3Fingerprint(unboundAssistant);

    const exactMessage = toPiContext(requestFixture([assistant]), exact).messages[0];
    expect(exactMessage).toMatchObject({
      role: 'assistant',
      provider: 'anthropic',
      content: [
        { type: 'thinking', thinking: 'private reasoning', thinkingSignature: 'signed-state' },
        { type: 'text', text: 'Visible answer' },
      ],
    });

    const changedModel = { ...exact, model: 'claude-other' };
    const semanticMessage = toPiContext(requestFixture([assistant]), changedModel).messages[0];
    expect(semanticMessage).toMatchObject({
      content: [
        { type: 'text', text: 'Visible answer' },
      ],
    });
    expect(JSON.stringify(semanticMessage)).not.toContain('signed-state');
    expect(JSON.stringify(semanticMessage)).not.toContain('portable reasoning');
  });

  it.each([
    {
      label: 'v3',
      metadata: (source: ReturnType<typeof createPiReplayContext>) => ({
        schemaVersion: 3 as const,
        source: replaySource(source),
        openAiResponsesCompaction: {
          responseId: 'compact-v3',
          items: [{ type: 'compaction' as const, encrypted_content: 'opaque-v3' }],
        },
      }),
    },
    {
      label: 'v2',
      metadata: (source: ReturnType<typeof createPiReplayContext>) => ({
        schemaVersion: 2 as const,
        source: replaySource(source),
        openAiResponses: {
          kind: 'compaction' as const,
          responseId: 'compact-v2',
          items: [{ type: 'compaction' as const, encrypted_content: 'opaque-v2' }],
        },
      }),
    },
  ])('replays $label native compaction from its user summary only inside the exact boundary', ({ metadata }) => {
    const provider = providerFixture('provider-a', 'openai-responses');
    const exact = createPiReplayContext(provider, 'gpt-test');
    const unboundSummary = messageFixture({
      role: 'user',
      content: 'portable summary',
      contextCompaction: {
        autoCompactTokenLimit: 1,
        compactedMessageCount: 1,
        compactedRequestTokens: 1,
        compactedTokens: 1,
        historyTokens: 1,
        keptRecentMessageCount: 0,
        maxContextTokens: 1,
        maxContextTokensK: 1,
        message: 'compacted',
        originalMessageCount: 1,
        originalRequestTokens: 1,
        originalTokens: 1,
        summaryRole: 'user',
        summaryTokens: 1,
        targetContextTokens: 1,
        tokensUntilCompaction: 0,
        triggerScopes: ['total'],
      },
      providerMetadata: metadata(exact),
    });
    const summary = unboundSummary.providerMetadata?.schemaVersion === 3
      ? bindV3Fingerprint(unboundSummary)
      : unboundSummary;

    const exactMessage = toPiContext(requestFixture([summary]), exact).messages[0];
    expect(exactMessage).toMatchObject({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '' }],
    });
    expect(JSON.stringify(exactMessage)).toContain('opaque-');
    expect(JSON.stringify(exactMessage)).not.toContain('portable summary');

    const changedModel = toPiContext(requestFixture([summary]), { ...exact, model: 'gpt-other' }).messages[0];
    expect(changedModel).toMatchObject({ role: 'user', content: 'portable summary' });
    expect(JSON.stringify(changedModel)).not.toContain('opaque-');
  });

  it('keeps tool images in one tool-result message and lets Pi perform protocol conversion', () => {
    const provider = providerFixture('provider-a', 'openai-compatible');
    const toolResult = messageFixture({
      role: 'tool',
      content: 'created image',
      toolCallId: 'call-1',
      toolName: 'render',
      attachments: [{
        id: 'image-1',
        name: 'result.png',
        type: 'image/png',
        size: 3,
        url: 'data:image/png;base64,YWJj',
      }],
    });

    const context = toPiContext(requestFixture([toolResult]), createPiReplayContext(provider, 'gpt-test'));

    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      content: [
        { type: 'text', text: 'created image' },
        { type: 'image', mimeType: 'image/png', data: 'YWJj' },
      ],
    });
  });
});

function providerFixture(
  id: string,
  kind: ProviderConfigState['provider'],
): ModelProviderRuntimeConfig {
  const activeModel = {
    id: 'model-1',
    name: 'Test model',
    code: kind === 'anthropic' ? 'claude-test' : 'gpt-test',
    enabled: true,
    maxOutputTokens: 8_192,
    thinkingEnabled: true,
    thinkingEfforts: ['low', 'high'],
  };
  return {
    id,
    name: 'Test provider',
    provider: kind,
    baseUrl: kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    enabled: true,
    apiKey: 'secret',
    models: [activeModel],
    activeModel,
  };
}

function requestFixture(messages: RuntimeMessage[]): ModelRequest {
  return { messages, model: 'test-model' };
}

function messageFixture(
  input: Pick<RuntimeMessage, 'content' | 'role'> & Partial<RuntimeMessage>,
): RuntimeMessage {
  return {
    id: 'message-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
    ...input,
  };
}

function replaySource(context: ReturnType<typeof createPiReplayContext>) {
  return {
    providerId: context.providerId,
    providerKind: context.providerKind,
    model: context.model,
    endpointFingerprint: context.endpointFingerprint,
  };
}

function bindV3Fingerprint(message: RuntimeMessage): RuntimeMessage {
  if (message.providerMetadata?.schemaVersion !== 3) return message;
  return {
    ...message,
    providerMetadata: {
      ...message.providerMetadata,
      semanticFingerprint: testSemanticFingerprint(message),
    },
  };
}

function testSemanticFingerprint(message: RuntimeMessage): string {
  const semanticValue = {
    role: message.role,
    content: message.content,
    toolCallId: message.toolCallId ?? null,
    toolName: message.toolName ?? null,
    toolCalls: (message.toolCalls ?? []).map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
    attachments: message.attachments ?? [],
  };
  return `sha256:${createHash('sha256').update(stableJson(semanticValue)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
