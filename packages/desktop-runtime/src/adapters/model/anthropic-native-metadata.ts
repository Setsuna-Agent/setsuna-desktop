import type {
  ModelStreamEvent,
  RuntimeAnthropicContentBlock,
} from '@setsuna-desktop/contracts';
import type { TextStreamPart, ToolSet } from 'ai';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import {
  providerMetadataFitsPersistenceLimit,
  providerMetadataSource,
  type ProviderReplayContext,
} from './provider-replay-context.js';
import { objectValue, stringValue } from './provider-values.js';

type AnthropicBlockState = {
  block: RuntimeAnthropicContentBlock;
  index: number;
  text: string;
  toolArguments: string;
};

/**
 * AI SDK owns Anthropic transport and normalized streaming. This collector only
 * retains the provider-native blocks required for signed-thinking replay.
 */
export class AnthropicNativeMetadataCollector {
  private readonly activeBlocks = new Map<number, AnthropicBlockState>();
  private readonly completedBlocks: RuntimeAnthropicContentBlock[] = [];
  private envelopeComplete = true;
  private messageStopped = false;

  constructor(
    private readonly provider: Pick<RuntimeProviderConfig, 'provider'>,
    private readonly replayContext: ProviderReplayContext,
    private readonly requestedModel: string,
  ) {}

  observe(part: TextStreamPart<ToolSet>): void {
    if (part.type !== 'raw') return;
    const payload = objectValue(part.rawValue);
    const type = stringValue(payload.type);
    if (type === 'content_block_start') {
      this.startBlock(payload);
    } else if (type === 'content_block_delta') {
      this.updateBlock(payload);
    } else if (type === 'content_block_stop') {
      this.completeBlock(payload);
    } else if (type === 'message_stop') {
      this.messageStopped = true;
      if (this.activeBlocks.size) this.envelopeComplete = false;
    }
  }

  terminalEvents(): ModelStreamEvent[] {
    if (!this.messageStopped || this.activeBlocks.size) this.envelopeComplete = false;
    if (!this.envelopeComplete || !shouldPreserveAnthropicContentBlocks(this.completedBlocks)) {
      return [];
    }
    const providerMetadata = {
      schemaVersion: 2 as const,
      source: providerMetadataSource(this.replayContext),
      anthropic: { contentBlocks: this.completedBlocks },
    };
    if (providerMetadataFitsPersistenceLimit(providerMetadata)) {
      return [{ type: 'assistant_metadata', providerMetadata }];
    }
    return [{
      type: 'model_verification',
      verification: {
        model: this.requestedModel,
        provider: this.provider.provider,
        warnings: ['provider_metadata_omitted_too_large'],
      },
    }];
  }

  private startBlock(payload: Record<string, unknown>): void {
    const state = anthropicBlockState(payload);
    if (!state || this.activeBlocks.has(state.index)) {
      this.envelopeComplete = false;
      return;
    }
    this.activeBlocks.set(state.index, state);
  }

  private updateBlock(payload: Record<string, unknown>): void {
    const index = typeof payload.index === 'number' ? payload.index : undefined;
    const state = index === undefined ? undefined : this.activeBlocks.get(index);
    const delta = objectValue(payload.delta);
    if (!state || !anthropicDeltaMatchesBlock(state, delta)) {
      this.envelopeComplete = false;
      return;
    }
    if (state.block.type === 'text') {
      state.text += stringValue(delta.text);
    } else if (state.block.type === 'thinking') {
      state.text += stringValue(delta.thinking);
      state.block.signature += stringValue(delta.signature);
    } else if (state.block.type === 'tool_use') {
      state.toolArguments += stringValue(delta.partial_json);
    }
  }

  private completeBlock(payload: Record<string, unknown>): void {
    const index = typeof payload.index === 'number' ? payload.index : undefined;
    const state = index === undefined ? undefined : this.activeBlocks.get(index);
    if (!state) {
      this.envelopeComplete = false;
      return;
    }
    this.activeBlocks.delete(state.index);
    const block = completedAnthropicBlock(state);
    if (block) this.completedBlocks.push(block);
    else this.envelopeComplete = false;
  }
}

function anthropicBlockState(payload: Record<string, unknown>): AnthropicBlockState | null {
  const block = objectValue(payload.content_block);
  const type = stringValue(block.type);
  const index = typeof payload.index === 'number' ? payload.index : 0;
  if (type === 'text') {
    const text = stringValue(block.text);
    return { block: { type: 'text', text }, index, text, toolArguments: '' };
  }
  if (type === 'thinking') {
    const text = stringValue(block.thinking);
    return {
      block: { type: 'thinking', thinking: text, signature: stringValue(block.signature) },
      index,
      text,
      toolArguments: '',
    };
  }
  if (type === 'redacted_thinking') {
    return {
      block: { type: 'redacted_thinking', data: stringValue(block.data) },
      index,
      text: '',
      toolArguments: '',
    };
  }
  if (type === 'tool_use') {
    const initialInput = block.input ?? {};
    const initialArguments = JSON.stringify(initialInput);
    return {
      block: {
        type: 'tool_use',
        id: stringValue(block.id) || `toolu_${index}`,
        name: stringValue(block.name),
        input: initialInput,
      },
      index,
      text: '',
      toolArguments: initialArguments === '{}' ? '' : initialArguments,
    };
  }
  return null;
}

function anthropicDeltaMatchesBlock(
  state: AnthropicBlockState,
  delta: Record<string, unknown>,
): boolean {
  const deltaType = stringValue(delta.type);
  if (state.block.type === 'text') {
    return (deltaType === 'text_delta' && typeof delta.text === 'string')
      || (!deltaType && typeof delta.text === 'string');
  }
  if (state.block.type === 'thinking') {
    return (deltaType === 'thinking_delta' && typeof delta.thinking === 'string')
      || (deltaType === 'signature_delta' && typeof delta.signature === 'string')
      || (!deltaType && (typeof delta.thinking === 'string' || typeof delta.signature === 'string'));
  }
  if (state.block.type === 'tool_use') {
    return (deltaType === 'input_json_delta' && typeof delta.partial_json === 'string')
      || (!deltaType && typeof delta.partial_json === 'string');
  }
  return false;
}

function completedAnthropicBlock(state: AnthropicBlockState): RuntimeAnthropicContentBlock | undefined {
  const block = state.block;
  if (block.type === 'thinking') {
    return block.signature ? { ...block, thinking: state.text } : undefined;
  }
  if (block.type === 'text') return { ...block, text: state.text };
  if (block.type === 'redacted_thinking') return block.data ? { ...block } : undefined;
  const input = parseToolInput(state.toolArguments);
  if (!block.id || !block.name || input === undefined) return undefined;
  return { ...block, input };
}

function parseToolInput(value: string): unknown | undefined {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function shouldPreserveAnthropicContentBlocks(blocks: RuntimeAnthropicContentBlock[]): boolean {
  return blocks.some((block) => block.type === 'tool_use')
    && blocks.some((block) => block.type === 'thinking' || block.type === 'redacted_thinking');
}
