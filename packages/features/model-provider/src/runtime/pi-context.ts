import {
  isRuntimeInlineMessageAttachment,
  sanitizeRuntimeJsonValue,
  type ModelProviderKind,
  type ModelRequest,
  type RuntimeJsonValue,
  type RuntimeMessage,
  type RuntimeProviderReplayBlock,
  type RuntimeProviderMetadataSource,
} from '@setsuna-desktop/contracts';
import {
  Type,
  type AssistantMessage,
  type Context,
  type ImageContent,
  type Message,
  type Model,
  type TextContent,
  type ThinkingContent,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import type { ModelProviderReplayDecision, ModelProviderRuntimeConfig } from '../contracts/index.js';
import {
  builtinCatalogProviderIdForConfig,
  getBuiltinCatalogModel,
  getBuiltinCatalogProvider,
} from './provider-catalog.js';
import { portableAssistantText } from './portable-assistant-text.js';

export type PiApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export type PiReplayContext = Readonly<{
  piProvider: string;
  providerId: string;
  providerKind: ModelProviderKind;
  model: string;
  endpointFingerprint: string;
  api: PiApi;
}>;

export function piApiForProvider(provider: ModelProviderKind): PiApi {
  if (provider === 'openai-responses') return 'openai-responses';
  if (provider === 'anthropic') return 'anthropic-messages';
  return 'openai-completions';
}

export function createPiModel(
  provider: ModelProviderRuntimeConfig,
  modelId: string,
  options: Readonly<{ forceAdaptiveThinking?: boolean }> = {},
): Model<PiApi> {
  const activeModel = provider.activeModel;
  const api = piApiForProvider(provider.provider);
  const catalogProviderId = builtinCatalogProviderIdForConfig(provider);
  const catalogProvider = catalogProviderId ? getBuiltinCatalogProvider(catalogProviderId) : undefined;
  const catalogModel = catalogProviderId
    ? getBuiltinCatalogModel(catalogProviderId, modelId)
    : undefined;
  const catalogBase = catalogModel?.api === api ? catalogModel : undefined;
  const apiModels = catalogProvider?.getModels().filter((candidate) => candidate.api === api) ?? [];
  const sameEndpointModels = apiModels.filter((candidate) => (
    normalizeProviderBaseUrl(candidate.baseUrl) === normalizeProviderBaseUrl(provider.baseUrl)
  ));
  const planModels = sameEndpointModels.length ? sameEndpointModels : apiModels;
  const inheritedHeaders = catalogBase?.headers ?? commonRecord(planModels.map((model) => model.headers));
  const inheritedCompat = catalogBase?.compat ?? commonRecord(planModels.map((model) => model.compat));
  return {
    ...(catalogBase ?? {}),
    id: modelId,
    name: activeModel?.name || modelId,
    api,
    // Pi uses this field to select provider-specific replay and compatibility rules.
    // The persisted Setsuna provider id remains separate in RuntimeProviderMetadataSource.
    provider: catalogProvider?.id ?? catalogBase?.provider ?? piProviderForKind(provider.provider),
    baseUrl: normalizedPiBaseUrl(provider),
    reasoning: activeModel ? activeModel.thinkingEnabled === true : catalogBase?.reasoning ?? false,
    input: activeModel
      ? (activeModel.supportsImages === true ? ['text', 'image'] : ['text'])
      : catalogBase?.input ?? ['text'],
    cost: catalogBase?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: activeModel?.contextWindowTokens ?? catalogBase?.contextWindow ?? 128_000,
    maxTokens: activeModel?.maxOutputTokens ?? catalogBase?.maxTokens ?? 8_192,
    thinkingLevelMap: catalogBase?.thinkingLevelMap ?? thinkingLevelMap(activeModel?.thinkingEfforts ?? []),
    ...(inheritedHeaders ? { headers: inheritedHeaders as Record<string, string> } : {}),
    ...(inheritedCompat ? { compat: inheritedCompat } : {}),
    ...(provider.provider === 'anthropic' && options.forceAdaptiveThinking
      ? { compat: { ...inheritedCompat, forceAdaptiveThinking: true } }
      : {}),
  };
}

export function createPiReplayContext(
  provider: ModelProviderRuntimeConfig,
  model: string,
): PiReplayContext {
  return {
    piProvider: createPiModel(provider, model).provider,
    providerId: provider.id,
    providerKind: provider.provider,
    model,
    endpointFingerprint: createHash('sha256').update(normalizeProviderBaseUrl(provider.baseUrl)).digest('hex'),
    api: piApiForProvider(provider.provider),
  };
}

export function providerMetadataMatchesPiReplayContext(
  message: RuntimeMessage,
  context: PiReplayContext,
): boolean {
  const metadata = message.providerMetadata;
  const source = metadata?.source;
  return (metadata?.schemaVersion === 2 || metadata?.schemaVersion === 3)
    && source?.providerId === context.providerId
    && source.providerKind === context.providerKind
    && source.model === context.model
    && source.endpointFingerprint === context.endpointFingerprint
    && (metadata.schemaVersion === 2
      ? !metadata.semanticFingerprint
        || metadata.semanticFingerprint === runtimeMessageSemanticFingerprint(message)
      : Boolean(metadata.semanticFingerprint)
        && metadata.semanticFingerprint === runtimeMessageSemanticFingerprint(message));
}

export function providerReplayDecisions(
  messages: readonly RuntimeMessage[],
  context: PiReplayContext,
): ModelProviderReplayDecision[] {
  return messages
    .filter((message) => message.visibility !== 'transcript' && message.role === 'assistant')
    .map((message) => {
      const metadata = message.providerMetadata;
      const exact = exactReplayBlocks(message, context);
      let reason: ModelProviderReplayDecision['reason'];
      if (context.api === 'openai-completions') reason = 'unsupported_provider';
      else if (!hasNativeReplayEnvelope(message, context)) reason = 'metadata_missing';
      else if (metadata?.schemaVersion === undefined && context.api !== 'anthropic-messages') {
        reason = 'legacy_provider_mismatch';
      } else if (!providerSourceMatchesContext(metadata?.source, context)) reason = 'context_mismatch';
      else if (!exact) reason = metadata?.semanticFingerprint ? 'semantic_mismatch' : 'native_envelope_invalid';
      else reason = 'native_replay_compatible';
      return {
        messageId: message.id,
        model: context.model,
        nativeItemCount: nativeReplayItemCount(message, context),
        providerId: context.providerId,
        providerKind: context.providerKind,
        reason,
        strategy: exact && context.api !== 'openai-completions' ? 'native' : 'semantic',
      };
    });
}

export function toPiContext(
  request: ModelRequest,
  replayContext: PiReplayContext,
): Context {
  const messages: Message[] = [];

  for (const message of request.messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'system' || message.role === 'developer') continue;
    const nativeCompaction = toPiNativeCompactionMessage(message, replayContext);
    if (nativeCompaction) {
      messages.push(nativeCompaction);
      continue;
    }
    if (message.role === 'user') {
      const userMessage = toPiUserMessage(message);
      if (userMessage) messages.push(userMessage);
      continue;
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistantMessage(message, replayContext);
      if (assistant.content.length) messages.push(assistant);
      continue;
    }
    if (message.role !== 'tool' || !message.toolCallId) continue;
    messages.push(toPiToolResult(message));
  }

  const systemPrompt = request.messages
    .filter((message) => (
      message.visibility !== 'transcript'
      && (message.role === 'system' || message.role === 'developer')
      && message.content.trim()
    ))
    .map((message) => message.content.trim())
    .join('\n\n');

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages,
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool): Tool => ({
            name: tool.name,
            description: tool.description,
            parameters: Type.Unsafe(tool.inputSchema as never),
          })),
        }
      : {}),
  };
}

function toPiUserMessage(message: RuntimeMessage): UserMessage | null {
  const images = inlineImages(message);
  const text = message.content;
  if (!images.length && !text) return null;
  return {
    role: 'user',
    content: images.length
      ? [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...images,
        ]
      : text,
    timestamp: messageTimestamp(message),
  };
}

function toPiToolResult(message: RuntimeMessage): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: message.toolCallId!,
    toolName: message.toolName || 'tool',
    content: [
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ...inlineImages(message),
    ],
    isError: Boolean(message.error || message.status === 'error'),
    timestamp: messageTimestamp(message),
  };
}

function toPiAssistantMessage(
  message: RuntimeMessage,
  context: PiReplayContext,
): AssistantMessage {
  const exactBlocks = exactReplayBlocks(message, context);
  const blocks = exactBlocks ?? semanticReplayBlocks(message);
  const responseId = exactBlocks ? exactReplayResponseId(message) : undefined;
  return {
    role: 'assistant',
    content: blocks.map(toPiReplayBlock),
    api: context.api,
    provider: context.piProvider,
    model: context.model,
    ...(responseId ? { responseId } : {}),
    usage: emptyPiUsage(),
    stopReason: message.toolCalls?.length ? 'toolUse' : 'stop',
    timestamp: messageTimestamp(message),
  };
}

function toPiNativeCompactionMessage(
  message: RuntimeMessage,
  context: PiReplayContext,
): AssistantMessage | null {
  if (context.api !== 'openai-responses' || !message.contextCompaction) return null;
  const metadata = message.providerMetadata;
  const hasCompactionEnvelope = metadata?.schemaVersion === 3
    ? Boolean(metadata.openAiResponsesCompaction?.items.length)
    : metadata?.schemaVersion === 2
      && metadata.openAiResponses?.kind === 'compaction'
      && Boolean(metadata.openAiResponses.items.length);
  if (!hasCompactionEnvelope || !exactReplayBlocks(message, context)) return null;
  return toPiAssistantMessage(message, context);
}

function exactReplayResponseId(message: RuntimeMessage): string | undefined {
  const metadata = message.providerMetadata;
  if (metadata?.schemaVersion === 3) {
    return metadata.openAiResponsesCompaction?.responseId ?? metadata.assistantReplay?.responseId;
  }
  return metadata?.schemaVersion === 2 ? metadata.openAiResponses?.responseId : undefined;
}

function piProviderForKind(provider: ModelProviderKind): 'anthropic' | 'openai' {
  return provider === 'anthropic' ? 'anthropic' : 'openai';
}

function exactReplayBlocks(
  message: RuntimeMessage,
  context: PiReplayContext,
): RuntimeProviderReplayBlock[] | null {
  const metadata = message.providerMetadata;
  const exactBoundary = providerMetadataMatchesPiReplayContext(message, context);

  if (metadata?.schemaVersion === 3 && exactBoundary) {
    if (context.api === 'openai-responses' && metadata.openAiResponsesCompaction?.items.length) {
      return metadata.openAiResponsesCompaction.items.map((item) => ({
        type: 'thinking',
        text: '',
        signature: JSON.stringify(item),
      }));
    }
    return metadata.assistantReplay?.blocks.map(cloneReplayBlock) ?? null;
  }

  if (metadata?.schemaVersion === 2 && exactBoundary) {
    if (context.api === 'anthropic-messages' && metadata.anthropic?.contentBlocks.length) {
      return metadata.anthropic.contentBlocks.map((block): RuntimeProviderReplayBlock => {
        if (block.type === 'thinking') {
          return { type: 'thinking', text: block.thinking, signature: block.signature };
        }
        if (block.type === 'redacted_thinking') {
          return { type: 'thinking', text: '[Reasoning redacted]', signature: block.data, redacted: true };
        }
        if (block.type === 'text') return { type: 'text', text: block.text };
        return {
          type: 'tool_call',
          id: block.id,
          name: block.name,
          arguments: sanitizeRuntimeJsonValue(block.input) ?? {},
        };
      });
    }
    if (context.api === 'openai-responses' && metadata.openAiResponses?.items.length) {
      return legacyResponsesReplayBlocks(metadata.openAiResponses.items);
    }
  }

  const legacyAnthropicBlocks = metadata && metadata.schemaVersion === undefined
    ? metadata.anthropic?.contentBlocks
    : undefined;
  if (
    context.api === 'anthropic-messages'
    && legacyAnthropicBlocks?.length
  ) {
    return legacyAnthropicBlocks.map((block): RuntimeProviderReplayBlock => {
      if (block.type === 'thinking') return { type: 'thinking', text: block.thinking, signature: block.signature };
      if (block.type === 'redacted_thinking') {
        return { type: 'thinking', text: '[Reasoning redacted]', signature: block.data, redacted: true };
      }
      if (block.type === 'text') return { type: 'text', text: block.text };
      return {
        type: 'tool_call',
        id: block.id,
        name: block.name,
        arguments: sanitizeRuntimeJsonValue(block.input) ?? {},
      };
    });
  }
  return null;
}

function hasNativeReplayEnvelope(message: RuntimeMessage, context: PiReplayContext): boolean {
  const metadata = message.providerMetadata;
  if (metadata?.schemaVersion === 3) {
    return Boolean(metadata.assistantReplay || (
      context.api === 'openai-responses' && metadata.openAiResponsesCompaction?.items.length
    ));
  }
  if (metadata?.schemaVersion === 2) {
    return context.api === 'openai-responses'
      ? Boolean(metadata.openAiResponses?.items.length)
      : context.api === 'anthropic-messages' && Boolean(metadata.anthropic?.contentBlocks.length);
  }
  return Boolean(metadata?.anthropic?.contentBlocks.length);
}

function nativeReplayItemCount(message: RuntimeMessage, context: PiReplayContext): number {
  const metadata = message.providerMetadata;
  if (metadata?.schemaVersion === 3) {
    return context.api === 'openai-responses' && metadata.openAiResponsesCompaction?.items.length
      ? metadata.openAiResponsesCompaction.items.length
      : metadata.assistantReplay?.blocks.length ?? 0;
  }
  if (metadata?.schemaVersion === 2) {
    return context.api === 'openai-responses'
      ? metadata.openAiResponses?.items.length ?? 0
      : metadata.anthropic?.contentBlocks.length ?? 0;
  }
  return metadata?.anthropic?.contentBlocks.length ?? 0;
}

function providerSourceMatchesContext(
  source: RuntimeProviderMetadataSource | undefined,
  context: PiReplayContext,
): boolean {
  if (!source) return context.api === 'anthropic-messages';
  return source.providerId === context.providerId
    && source.providerKind === context.providerKind
    && source.model === context.model
    && source.endpointFingerprint === context.endpointFingerprint;
}

function legacyResponsesReplayBlocks(items: readonly Record<string, RuntimeJsonValue>[]): RuntimeProviderReplayBlock[] {
  return items.flatMap((item): RuntimeProviderReplayBlock[] => {
    if (item.type === 'reasoning') {
      return [{ type: 'thinking', text: reasoningItemText(item), signature: JSON.stringify(item) }];
    }
    if (item.type === 'message' && item.role === 'assistant') {
      const text = responseMessageText(item);
      const id = typeof item.id === 'string' ? item.id : undefined;
      const phase = item.phase === 'commentary' || item.phase === 'final_answer' ? item.phase : undefined;
      return text ? [{
        type: 'text',
        text,
        ...(id ? { signature: JSON.stringify({ v: 1, id, ...(phase ? { phase } : {}) }) } : {}),
      }] : [];
    }
    if (item.type === 'function_call') {
      const id = typeof item.call_id === 'string' ? item.call_id : '';
      const name = typeof item.name === 'string' ? item.name : '';
      if (!id || !name) return [];
      return [{
        type: 'tool_call',
        id,
        name,
        arguments: parseJsonValue(typeof item.arguments === 'string' ? item.arguments : ''),
        ...(typeof item.id === 'string' ? { itemId: item.id } : {}),
      }];
    }
    // A compaction envelope is replayed verbatim through Pi's Responses signature channel.
    return [{ type: 'thinking', text: '', signature: JSON.stringify(item) }];
  });
}

function semanticReplayBlocks(message: RuntimeMessage): RuntimeProviderReplayBlock[] {
  const blocks: RuntimeProviderReplayBlock[] = [];
  const text = portableAssistantText(message);
  if (text) blocks.push({ type: 'text', text });
  for (const toolCall of message.toolCalls ?? []) {
    blocks.push({
      type: 'tool_call',
      id: toolCall.id,
      name: toolCall.name,
      arguments: parseJsonValue(toolCall.arguments),
    });
  }
  return blocks;
}

function toPiReplayBlock(block: RuntimeProviderReplayBlock): TextContent | ThinkingContent | ToolCall {
  if (block.type === 'text') {
    return {
      type: 'text',
      text: block.text,
      ...(block.signature ? { textSignature: block.signature } : {}),
    };
  }
  if (block.type === 'thinking') {
    return {
      type: 'thinking',
      thinking: block.text,
      ...(block.signature ? { thinkingSignature: block.signature } : {}),
      ...(block.redacted ? { redacted: true } : {}),
    };
  }
  return {
    type: 'toolCall',
    id: block.itemId ? `${block.id}|${block.itemId}` : block.id,
    name: block.name,
    arguments: cloneJsonObject(block.arguments),
    ...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
    ...(block.namespace ? { namespace: block.namespace } : {}),
  };
}

function inlineImages(message: RuntimeMessage): ImageContent[] {
  return (message.attachments ?? []).flatMap((attachment): ImageContent[] => {
    if (
      !isRuntimeInlineMessageAttachment(attachment)
      || attachment.modelVisible === false
      || !attachment.type.startsWith('image/')
    ) return [];
    const match = /^data:([^;,]+);base64,(.+)$/u.exec(attachment.url);
    if (!match?.[1] || !match[2]) return [];
    return [{ type: 'image', mimeType: match[1], data: match[2] }];
  });
}

function messageTimestamp(message: RuntimeMessage): number {
  const timestamp = Date.parse(message.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function emptyPiUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function responseMessageText(item: Record<string, RuntimeJsonValue>): string {
  return Array.isArray(item.content)
    ? item.content.flatMap((part) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) return [];
        return part.type === 'output_text' && typeof part.text === 'string'
          ? [part.text]
          : part.type === 'refusal' && typeof part.refusal === 'string'
            ? [part.refusal]
            : [];
      }).join('')
    : '';
}

function reasoningItemText(item: Record<string, RuntimeJsonValue>): string {
  return Array.isArray(item.summary)
    ? item.summary.flatMap((part) => (
        part && typeof part === 'object' && !Array.isArray(part) && typeof part.text === 'string'
          ? [part.text]
          : []
      )).join('\n\n')
    : '';
}

function parseJsonValue(value: string): RuntimeJsonValue {
  if (!value.trim()) return {};
  try {
    return sanitizeRuntimeJsonValue(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function cloneJsonObject(value: RuntimeJsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value) as Record<string, unknown>
    : {};
}

function cloneReplayBlock(block: RuntimeProviderReplayBlock): RuntimeProviderReplayBlock {
  return block.type === 'tool_call'
    ? { ...block, arguments: structuredClone(block.arguments) }
    : { ...block };
}

function runtimeMessageSemanticFingerprint(message: RuntimeMessage): string {
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
    attachments: sanitizeRuntimeJsonValue(message.attachments ?? []) ?? [],
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

function commonRecord(values: readonly (object | undefined)[]): Record<string, unknown> | undefined {
  if (!values.length || values.some((value) => !value)) return undefined;
  const [first, ...rest] = values as [object, ...object[]];
  const entries = Object.entries(first).filter(([key, value]) => rest.every((candidate) => (
    Object.hasOwn(candidate, key)
    && stableJson((candidate as Record<string, unknown>)[key]) === stableJson(value)
  )));
  return entries.length ? Object.fromEntries(entries.map(([key, value]) => [key, structuredClone(value)])) : undefined;
}

function thinkingLevelMap(efforts: readonly string[]) {
  const supported = new Set(efforts.map((effort) => effort.trim().toLowerCase()));
  if (!supported.size) return undefined;
  return Object.fromEntries(
    ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      .filter((effort) => supported.has(effort))
      .map((effort) => [effort, effort]),
  );
}

function normalizedPiBaseUrl(provider: ModelProviderRuntimeConfig): string {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/u, '');
  if (!baseUrl) throw new Error('Provider base URL is required.');
  if (provider.provider === 'openai-responses') return baseUrl.replace(/\/responses$/iu, '');
  if (provider.provider === 'anthropic') {
    if (/\/v1\/messages$/iu.test(baseUrl)) return baseUrl.replace(/\/v1\/messages$/iu, '');
    if (/\/messages$/iu.test(baseUrl)) return baseUrl.replace(/\/messages$/iu, '').replace(/\/v1$/iu, '');
    return baseUrl.replace(/\/v1$/iu, '');
  }
  return baseUrl.replace(/\/chat\/completions$/iu, '');
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
    url.searchParams.sort();
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.protocol}//${url.host}${path}${url.search}`;
  } catch {
    return trimmed.replace(/\/+$/u, '');
  }
}
