import {
  isRuntimeInlineMessageAttachment,
  normalizeRuntimeMessageProviderMetadata,
  sanitizeResponsesItems,
  type ModelCompactionRequest,
  type ModelCompactionResult,
  type RuntimeMessage,
  type RuntimeProviderReplayBlock,
} from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import {
  createPiReplayContext,
  providerMetadataMatchesPiReplayContext,
  type PiReplayContext,
} from './pi-context.js';
import { portableAssistantText } from './portable-assistant-text.js';

const MAX_ERROR_BODY_LENGTH = 500;

export async function compactOpenAiResponsesConversation(
  request: ModelCompactionRequest,
  provider: ModelProviderRuntimeConfig,
  fetchImpl: typeof fetch,
): Promise<ModelCompactionResult> {
  const replayContext = createPiReplayContext(provider, request.model);
  const response = await fetchImpl(withEndpoint(provider.baseUrl, '/responses/compact'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
    },
    signal: request.signal,
    body: JSON.stringify({
      model: request.model,
      input: toResponsesInput(request.messages, replayContext),
      ...(instructionText(request.messages) ? { instructions: instructionText(request.messages) } : {}),
    }),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_LENGTH);
    throw new Error(`OpenAI Responses compact request failed (${response.status})${body ? `: ${body}` : ''}`);
  }

  const payload = objectRecord(await response.json().catch(() => null));
  const nestedResponse = objectRecord(payload.response);
  const rawItems = Array.isArray(payload.output)
    ? payload.output
    : Array.isArray(nestedResponse.output)
      ? nestedResponse.output
      : undefined;
  const items = rawItems ? sanitizeResponsesItems(rawItems, 'compaction') : undefined;
  if (!items) {
    throw new Error('OpenAI Responses compact response did not include a complete replayable replacement item list.');
  }
  const providerMetadata = normalizeRuntimeMessageProviderMetadata({
    schemaVersion: 3,
    source: {
      providerId: replayContext.providerId,
      providerKind: replayContext.providerKind,
      model: replayContext.model,
      endpointFingerprint: replayContext.endpointFingerprint,
    },
    openAiResponsesCompaction: {
      ...(stringValue(payload.id) || stringValue(nestedResponse.id)
        ? { responseId: stringValue(payload.id) || stringValue(nestedResponse.id) }
        : {}),
      items,
    },
  });
  if (!providerMetadata) throw new Error('OpenAI Responses compact metadata exceeded the persistence boundary.');
  const usage = normalizeUsage(payload.usage ?? nestedResponse.usage);
  return {
    kind: 'native',
    providerMetadata,
    ...(usage
      ? {
          usage: {
            ...usage,
            providerId: provider.id,
            provider: provider.name,
            model: request.model,
          },
        }
      : {}),
  };
}

function toResponsesInput(messages: readonly RuntimeMessage[], replayContext: PiReplayContext): unknown[] {
  const output: unknown[] = [];
  messages.forEach((message, index) => {
    if (message.visibility === 'transcript' || message.role === 'system' || message.role === 'developer') return;
    const metadata = message.providerMetadata;
    const exactBoundary = providerMetadataMatchesPiReplayContext(message, replayContext);
    if (exactBoundary && metadata?.schemaVersion === 3 && metadata.openAiResponsesCompaction?.items.length) {
      output.push(...structuredClone(metadata.openAiResponsesCompaction.items));
      return;
    }
    if (exactBoundary && metadata?.schemaVersion === 2 && metadata.openAiResponses?.items.length) {
      output.push(...structuredClone(metadata.openAiResponses.items));
      return;
    }
    const replay = exactBoundary && metadata?.schemaVersion === 3
      ? metadata.assistantReplay?.blocks
      : undefined;
    if (replay?.length) {
      appendReplayBlocks(output, replay, index);
      return;
    }
    if (message.role === 'user') {
      output.push({ role: 'user', content: responsesUserContent(message) });
      return;
    }
    if (message.role === 'tool' && message.toolCallId) {
      output.push({ type: 'function_call_output', call_id: callId(message.toolCallId), output: message.content });
      const images = inlineImages(message);
      if (images.length) {
        output.push({
          role: 'user',
          content: responsesUserContent(message, `Image output from tool ${message.toolName || 'tool'}:`),
        });
      }
      return;
    }
    if (message.role !== 'assistant') return;
    const text = portableAssistantText(message);
    if (text) {
      output.push({
        type: 'message',
        id: `msg_setsuna_${index}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      });
    }
    for (const toolCall of message.toolCalls ?? []) {
      output.push({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });
    }
  });
  return output;
}

function appendReplayBlocks(
  output: unknown[],
  replay: readonly RuntimeProviderReplayBlock[],
  messageIndex: number,
): void {
  for (const block of replay) {
    if (block.type === 'thinking' && block.signature) {
      const item = parseObject(block.signature);
      if (item) output.push(item);
    } else if (block.type === 'text') {
      const signature = parseObject(block.signature);
      output.push({
        type: 'message',
        id: stringValue(signature.id) || `msg_setsuna_${messageIndex}`,
        role: 'assistant',
        status: 'completed',
        ...(signature.phase === 'commentary' || signature.phase === 'final_answer'
          ? { phase: signature.phase }
          : {}),
        content: [{ type: 'output_text', text: block.text, annotations: [] }],
      });
    } else if (block.type === 'tool_call') {
      output.push({
        type: 'function_call',
        ...(block.itemId ? { id: block.itemId } : {}),
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      });
    }
  }
}

function responsesUserContent(message: RuntimeMessage, text = message.content): unknown {
  const images = inlineImages(message);
  if (!images.length) return text;
  return [
    ...(text.trim() ? [{ type: 'input_text', text }] : []),
    ...images.map((image) => ({ type: 'input_image', image_url: image.url, detail: 'auto' })),
  ];
}

function inlineImages(message: RuntimeMessage) {
  return (message.attachments ?? []).filter((attachment) => (
    isRuntimeInlineMessageAttachment(attachment)
    && attachment.modelVisible !== false
    && attachment.type.startsWith('image/')
  ));
}

function instructionText(messages: readonly RuntimeMessage[]): string {
  return messages
    .filter((message) => (
      message.visibility !== 'transcript'
      && (message.role === 'system' || message.role === 'developer')
      && message.content.trim()
    ))
    .map((message) => message.content.trim())
    .join('\n\n');
}

function normalizeUsage(value: unknown) {
  const usage = objectRecord(value);
  const inputTokens = numberValue(usage.input_tokens ?? usage.prompt_tokens);
  const inputDetails = objectRecord(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const cachedInputTokens = numberValue(inputDetails.cached_tokens);
  const outputTokens = numberValue(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
    ? undefined
    : { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

function withEndpoint(baseUrl: string, endpoint: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, '').replace(/\/responses$/iu, '');
  if (!normalized) throw new Error('Provider base URL is required.');
  return `${normalized}${endpoint}`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return objectRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function callId(value: string): string {
  const separator = value.indexOf('|');
  return separator < 0 ? value : value.slice(0, separator);
}
