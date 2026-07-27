import type {
  RuntimeAnthropicContentBlock,
  RuntimeMessage,
  RuntimeProviderReplayDebugPayload,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import {
  portableRuntimeAssistantText,
  providerMetadataMatchesSemanticMessage,
  runtimeJsonValuesEqual,
} from '../../utils/runtime-message-semantic-fingerprint.js';
import {
  inlineImageAttachments,
  parseInlineImageDataUrl,
  portableAssistantText,
} from './provider-message-content.js';
import {
  isLegacyAnthropicMetadata,
  providerMetadataMatchesReplayContext,
  type ProviderReplayContext,
} from './provider-replay-context.js';

export function toAnthropicMessages(
  messages: RuntimeMessage[],
  replayContext: ProviderReplayContext,
): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'user') {
      output.push({ role: 'user', content: anthropicUserContentParts(message) });
    } else if (message.role === 'assistant') {
      const replayBlocks = anthropicReplayBlocks(message, replayContext);
      const blocks = replayBlocks.length ? replayBlocks : anthropicAssistantContentParts(message);
      output.push({
        role: 'assistant',
        content: blocks.length ? blocks : portableAssistantText(message.content),
      });
    } else if (message.role === 'tool' && message.toolCallId) {
      output.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: inlineImageAttachments(message).length
              ? anthropicUserContentParts(message)
              : message.content,
          },
        ],
      });
    }
  }
  return output;
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

export function toAnthropicTools(tools: RuntimeToolDefinition[] = []): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function anthropicAssistantContentParts(message: RuntimeMessage): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const assistantText = portableAssistantText(message.content);
  if (assistantText) blocks.push({ type: 'text', text: assistantText });
  for (const toolCall of message.toolCalls ?? []) {
    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: parseToolInput(toolCall.arguments),
    });
  }
  return blocks;
}

function anthropicReplayBlocks(
  message: RuntimeMessage,
  replayContext: ProviderReplayContext,
): Array<Record<string, unknown>> {
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
  return blocks.map((block) => {
    if (block.type === 'thinking') {
      return { type: block.type, thinking: block.thinking, signature: block.signature };
    }
    if (block.type === 'redacted_thinking') return { type: block.type, data: block.data };
    if (block.type === 'text') return { type: block.type, text: block.text };
    return { type: block.type, id: block.id, name: block.name, input: cloneJsonValue(block.input) };
  });
}

function anthropicBlocksMatchSemanticMessage(
  blocks: RuntimeAnthropicContentBlock[],
  message: RuntimeMessage,
): boolean {
  const nativeText = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (nativeText !== portableRuntimeAssistantText(message.content)) return false;

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

function parseToolInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) return {};
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return {};
  }
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

function anthropicUserContentParts(message: RuntimeMessage): unknown {
  const attachments = inlineImageAttachments(message);
  if (!attachments.length) return message.content;
  const blocks: unknown[] = [];
  if (message.content.trim()) blocks.push({ type: 'text', text: message.content });
  for (const attachment of attachments) {
    const data = parseInlineImageDataUrl(attachment.url);
    if (data) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: data.mediaType || attachment.type || 'image/jpeg',
          data: data.base64,
        },
      });
    } else {
      blocks.push({ type: 'text', text: `[image: ${attachment.name}] ${attachment.url}` });
    }
  }
  return blocks;
}
