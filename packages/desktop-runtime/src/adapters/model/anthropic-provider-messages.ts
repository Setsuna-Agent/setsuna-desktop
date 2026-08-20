import type {
  RuntimeAnthropicContentBlock,
  RuntimeMessage,
  RuntimeProviderReplayDebugPayload,
} from '@setsuna-desktop/contracts';
import type { AssistantContent, ModelMessage, SystemModelMessage } from 'ai';
import {
  providerMetadataMatchesSemanticMessage,
  runtimeJsonValuesEqual,
} from '../../utils/runtime-message-semantic-fingerprint.js';
import {
  aiSdkFilePart,
  aiSdkInlineAttachments,
  parseAiSdkToolInput,
  type AiSdkPromptOptions,
} from './ai-sdk-prompt.js';
import { providerAssistantText } from './provider-message-content.js';
import {
  isLegacyAnthropicMetadata,
  providerMetadataMatchesReplayContext,
  type ProviderReplayContext,
} from './provider-replay-context.js';

type AiSdkAssistantPart = Exclude<AssistantContent, string>[number];

export function anthropicAiSdkInstructions(
  messages: RuntimeMessage[],
  cacheBreakpointMessageId?: string,
): SystemModelMessage[] | undefined {
  const instructionMessages = messages.filter((message) => (
    message.visibility !== 'transcript'
    && (message.role === 'system' || message.role === 'developer')
    && message.content.trim()
  ));
  if (!instructionMessages.length) return undefined;

  return instructionMessages.map((message, index) => ({
    role: 'system',
    // Preserve the exact text produced by the previous joined-string path while
    // keeping provider-visible block boundaries available for cache control.
    content: `${index ? '\n\n' : ''}${message.content.trim()}`,
    ...(message.id === cacheBreakpointMessageId
      ? {
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        }
      : {}),
  }));
}

export function anthropicAiSdkPromptOptions(
  replayContext: ProviderReplayContext,
): AiSdkPromptOptions {
  return {
    appendToolVisuals: false,
    assistantContent: (message) => anthropicAssistantContent(message, replayContext),
    toolMessage: anthropicToolMessage,
  };
}

export function diagnoseAnthropicReplay(
  message: RuntimeMessage,
  replayContext: ProviderReplayContext,
): Pick<RuntimeProviderReplayDebugPayload, 'nativeItemCount' | 'reason' | 'strategy'> {
  const metadata = message.providerMetadata;
  const legacy = isLegacyAnthropicMetadata(metadata);
  const blocks = metadata?.anthropic?.contentBlocks;
  if (!blocks?.length) {
    return { nativeItemCount: 0, reason: 'metadata_missing', strategy: 'semantic' };
  }
  if (legacy) {
    return replayContext.providerKind === 'anthropic'
      ? { nativeItemCount: blocks.length, reason: 'native_replay_compatible', strategy: 'native' }
      : { nativeItemCount: blocks.length, reason: 'legacy_provider_mismatch', strategy: 'semantic' };
  }
  if (!providerMetadataMatchesReplayContext(metadata, replayContext)) {
    return { nativeItemCount: blocks.length, reason: 'context_mismatch', strategy: 'semantic' };
  }
  if (
    !providerMetadataMatchesSemanticMessage(metadata, message)
    || !anthropicBlocksMatchSemanticMessage(blocks, message)
  ) {
    return { nativeItemCount: blocks.length, reason: 'semantic_mismatch', strategy: 'semantic' };
  }
  return { nativeItemCount: blocks.length, reason: 'native_replay_compatible', strategy: 'native' };
}

function anthropicAssistantContent(
  message: RuntimeMessage,
  replayContext: ProviderReplayContext,
): AssistantContent {
  const replayBlocks = anthropicReplayBlocks(message, replayContext);
  if (replayBlocks.length) return replayBlocks.map(toAiSdkAnthropicBlock);

  const parts: AiSdkAssistantPart[] = [];
  const assistantText = providerAssistantText(message);
  if (assistantText) parts.push({ type: 'text', text: assistantText });
  for (const toolCall of message.toolCalls ?? []) {
    parts.push({
      type: 'tool-call',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: parseAiSdkToolInput(toolCall.arguments),
    });
  }
  return parts.length ? parts : assistantText;
}

function anthropicToolMessage(message: RuntimeMessage): ModelMessage | null {
  if (!message.toolCallId) return null;
  const attachments = aiSdkInlineAttachments(message);
  const output = attachments.length
    ? {
        type: 'content' as const,
        value: [
          ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
          ...attachments.map(aiSdkFilePart),
        ],
      }
    : { type: 'text' as const, value: message.content };
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: message.toolCallId,
      toolName: message.toolName || 'tool',
      output,
    }],
  };
}

function anthropicReplayBlocks(
  message: RuntimeMessage,
  replayContext: ProviderReplayContext,
): RuntimeAnthropicContentBlock[] {
  const metadata = message.providerMetadata;
  const legacy = isLegacyAnthropicMetadata(metadata);
  const canReplay = legacy
    ? replayContext.providerKind === 'anthropic'
    : providerMetadataMatchesReplayContext(metadata, replayContext);
  const blocks = canReplay ? metadata?.anthropic?.contentBlocks : undefined;
  if (!blocks?.length) return [];
  if (!legacy && (
    !providerMetadataMatchesSemanticMessage(metadata, message)
    || !anthropicBlocksMatchSemanticMessage(blocks, message)
  )) return [];
  return blocks.map(cloneAnthropicBlock);
}

function toAiSdkAnthropicBlock(block: RuntimeAnthropicContentBlock): AiSdkAssistantPart {
  if (block.type === 'thinking') {
    return {
      type: 'reasoning',
      text: block.thinking,
      providerOptions: { anthropic: { signature: block.signature } },
    };
  }
  if (block.type === 'redacted_thinking') {
    return {
      type: 'reasoning',
      text: '',
      providerOptions: { anthropic: { redactedData: block.data } },
    };
  }
  if (block.type === 'text') return { type: 'text', text: block.text };
  return {
    type: 'tool-call',
    toolCallId: block.id,
    toolName: block.name,
    input: cloneJsonValue(block.input),
  };
}

function cloneAnthropicBlock(block: RuntimeAnthropicContentBlock): RuntimeAnthropicContentBlock {
  return block.type === 'tool_use'
    ? { ...block, input: cloneJsonValue(block.input) }
    : { ...block };
}

function anthropicBlocksMatchSemanticMessage(
  blocks: RuntimeAnthropicContentBlock[],
  message: RuntimeMessage,
): boolean {
  const nativeText = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (nativeText !== providerAssistantText(message)) return false;

  const nativeCalls = blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    }));
  const semanticCalls = message.toolCalls ?? [];
  if (nativeCalls.length !== semanticCalls.length) return false;
  return nativeCalls.every((call, index) => {
    const semanticCall = semanticCalls[index];
    const semanticInput = semanticCall
      ? parseToolInputForComparison(semanticCall.arguments)
      : undefined;
    return Boolean(
      semanticCall
      && semanticInput !== undefined
      && call.id === semanticCall.id
      && call.name === semanticCall.name
      && runtimeJsonValuesEqual(call.input, semanticInput),
    );
  });
}

function parseToolInputForComparison(argumentsText: string): unknown {
  if (!argumentsText.trim()) return {};
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return undefined;
  }
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}
