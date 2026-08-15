import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { AssistantContent, ModelMessage, UserContent } from 'ai';
import { parseAiSdkToolInput } from './ai-sdk-prompt.js';
import { compatibleOpenAiResponsesItems } from './openai-responses-provider-metadata.js';
import {
  inlineImageAttachments,
  providerAssistantText,
  toolVisualMessage,
} from './provider-message-content.js';
import type { ProviderReplayContext } from './provider-replay-context.js';

export function toOpenAiMessages(messages: RuntimeMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const pendingToolVisuals: RuntimeMessage[] = [];
  const flushToolVisuals = () => {
    for (const message of pendingToolVisuals.splice(0, pendingToolVisuals.length)) {
      output.push({ role: 'user', content: openAiChatContentParts(toolVisualMessage(message)) });
    }
  };
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role !== 'tool') flushToolVisuals();
    if (message.role === 'system' || message.role === 'developer' || message.role === 'user' || message.role === 'assistant') {
      const content = message.role === 'assistant'
        ? providerAssistantText(message)
        : message.content;
      output.push({
        role: message.role,
        content: message.role === 'user' && inlineImageAttachments(message).length
          ? openAiChatContentParts(message)
          : content || (message.toolCalls?.length ? null : ''),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
          : {}),
      });
    } else if (message.role === 'tool') {
      output.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: message.content,
      });
      if (inlineImageAttachments(message).length) pendingToolVisuals.push(message);
    }
  }
  flushToolVisuals();
  return output;
}

export function toOpenAiResponsesInput(
  messages: RuntimeMessage[],
  replayContext: ProviderReplayContext,
): unknown[] {
  return buildOpenAiResponsesInput(messages, replayContext).input;
}

export function toOpenAiResponsesAiSdkPrompt(
  messages: RuntimeMessage[],
  replayContext: ProviderReplayContext,
): {
  messages: ModelMessage[];
  nativeReplayInput?: unknown[];
} {
  const { input, hasNativeReplay } = buildOpenAiResponsesInput(messages, replayContext);
  return {
    messages: responsesInputToAiSdkMessages(input),
    // AI SDK's ModelMessage shape cannot express Responses refusal parts or
    // output-text annotations. The fetch extension restores this sanitized
    // input verbatim only when a compatible native envelope was selected.
    ...(hasNativeReplay ? { nativeReplayInput: input } : {}),
  };
}

function buildOpenAiResponsesInput(
  messages: RuntimeMessage[],
  replayContext: ProviderReplayContext,
): {
  input: unknown[];
  hasNativeReplay: boolean;
} {
  const output: unknown[] = [];
  const toolOutputsByCallId = openAiResponsesToolOutputsByCallId(messages);
  let hasNativeReplay = false;
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    const nativeItems = compatibleOpenAiResponsesItems(message, replayContext);
    if (nativeItems) {
      hasNativeReplay = true;
      output.push(...nativeItems);
      for (const item of nativeItems) {
        if (item.type !== 'function_call' || typeof item.call_id !== 'string') continue;
        const toolOutput = toolOutputsByCallId.get(item.call_id);
        if (toolOutput) output.push(toolOutput);
      }
      continue;
    }
    if (message.role === 'developer') {
      output.push({ role: 'developer', content: message.content });
    } else if (message.role === 'user') {
      output.push({ role: 'user', content: openAiResponsesContentParts(message) });
    } else if (message.role === 'assistant') {
      const assistantText = providerAssistantText(message);
      if (assistantText) output.push({ role: 'assistant', content: assistantText });
      for (const toolCall of message.toolCalls ?? []) {
        output.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
        const toolOutput = toolOutputsByCallId.get(toolCall.id);
        if (toolOutput) output.push(toolOutput);
      }
    } else if (message.role === 'tool' && inlineImageAttachments(message).length) {
      output.push({ role: 'user', content: openAiResponsesContentParts(toolVisualMessage(message)) });
    }
  }
  return { input: output, hasNativeReplay };
}

function responsesInputToAiSdkMessages(input: unknown[]): ModelMessage[] {
  const toolNames = new Map<string, string>();
  for (const value of input) {
    const item = objectRecord(value);
    if (item?.type === 'function_call' && typeof item.call_id === 'string') {
      toolNames.set(item.call_id, typeof item.name === 'string' ? item.name : 'tool');
    }
  }

  const output: ModelMessage[] = [];
  for (const value of input) {
    const item = objectRecord(value);
    if (!item) continue;
    const role = typeof item.role === 'string' ? item.role : '';
    if (role === 'developer' || role === 'system') {
      output.push({ role: 'system', content: responseMessageText(item.content) });
    } else if (role === 'user') {
      output.push({ role: 'user', content: responseUserContent(item.content) });
    } else if (role === 'assistant') {
      output.push({ role: 'assistant', content: responseAssistantContent(item) });
    } else if (item.type === 'reasoning') {
      const content = responseReasoningContent(item);
      if (content) output.push({ role: 'assistant', content });
    } else if (item.type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : '';
      if (!callId) continue;
      output.push({
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: callId,
          toolName: typeof item.name === 'string' ? item.name : 'tool',
          input: parseAiSdkToolInput(
            typeof item.arguments === 'string' ? item.arguments : '{}',
          ),
          ...(typeof item.id === 'string'
            ? { providerOptions: { openai: { itemId: item.id } } }
            : {}),
        }],
      });
    } else if (item.type === 'function_call_output') {
      const callId = typeof item.call_id === 'string' ? item.call_id : '';
      if (!callId) continue;
      output.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          toolName: toolNames.get(callId) || 'tool',
          output: {
            type: 'text',
            value: typeof item.output === 'string' ? item.output : '',
          },
        }],
      });
    } else if (item.type === 'compaction' && typeof item.id === 'string') {
      output.push({
        role: 'assistant',
        content: [{
          type: 'custom',
          kind: 'openai.compaction',
          providerOptions: {
            openai: {
              itemId: item.id,
              ...(typeof item.encrypted_content === 'string'
                ? { encryptedContent: item.encrypted_content }
                : {}),
            },
          },
        }],
      });
    }
  }
  return output;
}

function openAiResponsesToolOutputsByCallId(messages: RuntimeMessage[]): Map<string, unknown> {
  const outputTextByCallId = new Map<string, string[]>();
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role !== 'tool' || !message.toolCallId) continue;
    const outputs = outputTextByCallId.get(message.toolCallId) ?? [];
    outputs.push(message.content);
    outputTextByCallId.set(message.toolCallId, outputs);
  }
  return new Map([...outputTextByCallId].map(([callId, outputs]) => [
    callId,
    {
      type: 'function_call_output',
      call_id: callId,
      output: outputs.join('\n\n'),
    },
  ]));
}

function openAiChatContentParts(message: RuntimeMessage): unknown[] {
  return [
    ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
    ...inlineImageAttachments(message).map((attachment) => ({
      type: 'image_url',
      image_url: { url: attachment.url },
    })),
  ];
}

function openAiResponsesContentParts(message: RuntimeMessage): unknown {
  const attachments = inlineImageAttachments(message);
  if (!attachments.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: 'input_text', text: message.content }] : []),
    ...attachments.map((attachment) => ({
      type: 'input_image',
      image_url: attachment.url,
    })),
  ];
}

function responseAssistantContent(item: Record<string, unknown>): AssistantContent {
  const text = responseMessageText(item.content);
  const providerOptions = {
    openai: {
      ...(typeof item.id === 'string' ? { itemId: item.id } : {}),
      ...(item.phase === 'commentary' || item.phase === 'final_answer'
        ? { phase: item.phase }
        : {}),
    },
  };
  return [{
    type: 'text',
    text,
    ...(Object.keys(providerOptions.openai).length ? { providerOptions } : {}),
  }];
}

function responseReasoningContent(item: Record<string, unknown>): AssistantContent | undefined {
  const itemId = typeof item.id === 'string' ? item.id : undefined;
  const encryptedContent = typeof item.encrypted_content === 'string'
    ? item.encrypted_content
    : undefined;
  // Compatible Responses endpoints may return replayable plaintext reasoning.
  // Keep it out of the SDK shadow prompt because @ai-sdk/openai rejects it with
  // store=false; createOpenAiResponsesFetch restores the exact native input.
  if (!encryptedContent) return undefined;
  const summary = Array.isArray(item.summary)
    ? item.summary
      .map((part) => objectRecord(part))
      .filter((part): part is Record<string, unknown> => Boolean(part))
      .map((part) => typeof part.text === 'string' ? part.text : '')
    : [];
  const texts = summary.length ? summary : [''];
  return texts.map((text) => ({
    type: 'reasoning' as const,
    text,
    providerOptions: {
      openai: {
        ...(itemId ? { itemId } : {}),
        ...(encryptedContent ? { reasoningEncryptedContent: encryptedContent } : {}),
      },
    },
  }));
}

function responseUserContent(value: unknown): UserContent {
  if (!Array.isArray(value)) return responseMessageText(value);
  const parts: Exclude<UserContent, string> = [];
  for (const rawPart of value) {
    const part = objectRecord(rawPart);
    if (part?.type === 'input_text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
    } else if (part?.type === 'input_image' && typeof part.image_url === 'string') {
      parts.push(responseImagePart(part.image_url));
    }
  }
  return parts;
}

function responseImagePart(url: string): Exclude<UserContent, string>[number] {
  const data = url.match(/^data:([^;,]+);base64,(.+)$/);
  return {
    type: 'file',
    mediaType: data?.[1] || 'image/*',
    data: data
      ? { type: 'data', data: data[2] }
      : { type: 'url', url: new URL(url) },
  };
}

function responseMessageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((rawPart) => {
    const part = objectRecord(rawPart);
    if (part?.type === 'output_text' || part?.type === 'input_text') {
      return typeof part.text === 'string' ? part.text : '';
    }
    if (part?.type === 'refusal') return typeof part.refusal === 'string' ? part.refusal : '';
    return '';
  }).join('');
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
