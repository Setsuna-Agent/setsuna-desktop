import type { RuntimeMessageProviderMetadata } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  bindProviderMetadataToSemanticMessage,
  providerMetadataMatchesSemanticMessage,
} from '../../../src/utils/runtime-message-semantic-fingerprint.js';
import { mergeRuntimeProviderMetadata } from '../../../src/loop/core/runtime-provider-metadata.js';

describe('runtime provider metadata merge', () => {
  it('appends Anthropic blocks and detaches nested input', () => {
    const first: RuntimeMessageProviderMetadata = {
      anthropic: {
        contentBlocks: [{ type: 'thinking', thinking: 'reason', signature: 'signed' }],
      },
    };
    const second: RuntimeMessageProviderMetadata = {
      anthropic: {
        contentBlocks: [{ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'README.md' } }],
      },
    };

    const merged = mergeRuntimeProviderMetadata(first, second);
    (second.anthropic!.contentBlocks[0] as { input: { path: string } }).input.path = 'mutated';

    expect(merged?.anthropic?.contentBlocks).toEqual([
      { type: 'thinking', thinking: 'reason', signature: 'signed' },
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'README.md' } },
    ]);
  });

  it('uses the last complete Responses envelope instead of concatenating fragments', () => {
    const first = responsesMetadata('resp_1', 'message_1');
    const second = responsesMetadata('resp_2', 'message_2');

    const merged = mergeRuntimeProviderMetadata(first, second);
    second.openAiResponses!.items[0]!.id = 'mutated';

    expect(merged?.openAiResponses).toEqual({
      kind: 'response',
      responseId: 'resp_2',
      items: [{ type: 'message', id: 'message_2', content: [] }],
    });
  });

  it('drops an oversized native envelope instead of falling back to the unsanitized value', () => {
    const merged = mergeRuntimeProviderMetadata(undefined, {
      schemaVersion: 2,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses',
        model: 'gpt-test',
        endpointFingerprint: 'a'.repeat(64),
      },
      openAiResponses: {
        kind: 'response',
        items: [{
          type: 'reasoning',
          id: 'reasoning-large',
          encrypted_content: 'x'.repeat(2 * 1024 * 1024),
        }],
      },
    });

    expect(merged).toBeUndefined();
  });

  it('binds native metadata to finalized semantic content', () => {
    const message = {
      id: 'assistant_1',
      role: 'assistant' as const,
      content: 'Portable answer',
      createdAt: '2026-07-23T00:00:00.000Z',
    };
    const bound = bindProviderMetadataToSemanticMessage(
      responsesMetadata('resp_1', 'message_1'),
      message,
    );

    expect(bound?.semanticFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(providerMetadataMatchesSemanticMessage(bound, message)).toBe(true);
    expect(providerMetadataMatchesSemanticMessage(bound, {
      ...message,
      content: `${message.content}\n\nRuntime-added note`,
    })).toBe(false);
  });
});

function responsesMetadata(responseId: string, itemId: string): RuntimeMessageProviderMetadata {
  return {
    schemaVersion: 2,
    source: {
      providerId: 'provider-1',
      providerKind: 'openai-responses',
      model: 'gpt-test',
      endpointFingerprint: 'a'.repeat(64),
    },
    openAiResponses: {
      kind: 'response',
      responseId,
      items: [{ type: 'message', id: itemId, content: [] }],
    },
  };
}
