import { DEFAULT_ANTHROPIC_MODEL_MAX_OUTPUT_TOKENS, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, isRuntimeInlineMessageAttachment, type ModelStreamEvent, type RuntimeInlineMessageAttachment, type RuntimeMessage, type RuntimeToolDefinition, type RuntimeUsage } from '@setsuna-desktop/contracts';

export type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_MAX_OUTPUT_TOKENS = DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
export const DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS = DEFAULT_ANTHROPIC_MODEL_MAX_OUTPUT_TOKENS;

export function requireFetch(fetchImpl: FetchImpl | undefined): FetchImpl {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Current Node runtime does not expose fetch.');
  }
  return fetchImpl;
}

export function withEndpoint(baseUrl: string, endpoint: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '');
  if (!trimmed) throw new Error('Provider base URL is required.');
  if (trimmed.endsWith(endpoint)) return trimmed;
  return `${trimmed}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export function bearerAuthHeader(apiKey: string): Record<string, string> {
  const token = apiKey.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function anthropicApiKeyHeader(apiKey: string): Record<string, string> {
  const token = apiKey.trim();
  return token ? { 'x-api-key': token } : {};
}

export async function assertOkResponse(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => '');
  throw new Error(`${label}: HTTP ${response.status}${text ? ` ${text.slice(0, 500)}` : ''}`);
}

export async function* parseSse(response: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/(?:\r\n|\r|\n){2}/);
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const parsed = parseSseEventBlock(chunk);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseEventBlock(buffer);
    if (parsed) yield parsed;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseSseEventBlock(block: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value.trim();
    if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return null;
  const data = dataLines.join('\n');
  return data ? { ...(event ? { event } : {}), data } : null;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Model stream returned invalid JSON: ${detail}`);
  }
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

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
      output.push({
        role: message.role,
        content: message.role === 'user' && inlineAttachments(message).length
          ? openAiChatContentParts(message)
          : message.content || (message.toolCalls?.length ? null : ''),
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
      if (inlineAttachments(message).length) pendingToolVisuals.push(message);
    }
  }
  flushToolVisuals();
  return output;
}

export function systemText(messages: RuntimeMessage[]): string {
  return instructionText(messages, new Set(['system']));
}

export function systemAndDeveloperText(messages: RuntimeMessage[]): string {
  return instructionText(messages, new Set(['system', 'developer']));
}

function instructionText(messages: RuntimeMessage[], roles: ReadonlySet<RuntimeMessage['role']>): string {
  return messages
    .filter((message) => message.visibility !== 'transcript' && roles.has(message.role) && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n\n');
}

export function nonSystemChatMessages(messages: RuntimeMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const output: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'user' || message.role === 'assistant') {
      output.push({ role: message.role, content: message.content });
    }
  }
  return output;
}

export function toOpenAiResponsesInput(messages: RuntimeMessage[]): unknown[] {
  const output: unknown[] = [];
  const toolOutputsByCallId = openAiResponsesToolOutputsByCallId(messages);
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'developer') {
      output.push({ role: 'developer', content: message.content });
    } else if (message.role === 'user') {
      output.push({ role: 'user', content: openAiResponsesContentParts(message) });
    } else if (message.role === 'assistant') {
      if (message.content) output.push({ role: 'assistant', content: message.content });
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
    } else if (message.role === 'tool' && inlineAttachments(message).length) {
      output.push({ role: 'user', content: openAiResponsesContentParts(toolVisualMessage(message)) });
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

export function toOpenAiResponsesTools(tools: RuntimeToolDefinition[] = []): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export function toAnthropicMessages(messages: RuntimeMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'user') {
      output.push({ role: 'user', content: anthropicUserContentParts(message) });
    } else if (message.role === 'assistant') {
      const replayBlocks = anthropicReplayBlocks(message);
      const blocks = replayBlocks.length ? replayBlocks : anthropicAssistantContentParts(message);
      output.push({
        role: 'assistant',
        content: blocks.length ? blocks : message.content,
      });
    } else if (message.role === 'tool' && message.toolCallId) {
      output.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: inlineAttachments(message).length
              ? anthropicUserContentParts(message)
              : message.content,
          },
        ],
      });
    }
  }
  return output;
}

function anthropicAssistantContentParts(message: RuntimeMessage): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  if (message.content) blocks.push({ type: 'text', text: message.content });
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

function anthropicReplayBlocks(message: RuntimeMessage): Array<Record<string, unknown>> {
  const blocks = message.providerMetadata?.anthropic?.contentBlocks;
  if (!blocks?.length) return [];
  return blocks.map((block) => {
    if (block.type === 'thinking') {
      return { type: block.type, thinking: block.thinking, signature: block.signature };
    }
    if (block.type === 'redacted_thinking') return { type: block.type, data: block.data };
    if (block.type === 'text') return { type: block.type, text: block.text };
    return { type: block.type, id: block.id, name: block.name, input: cloneJsonValue(block.input) };
  });
}

export function toAnthropicTools(tools: RuntimeToolDefinition[] = []): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export function normalizeOpenAiUsage(value: unknown): RuntimeUsage | undefined {
  const usage = objectValue(value);
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens);
  const inputDetails = objectValue(usage.prompt_tokens_details ?? usage.input_tokens_details ?? usage.input_token_details);
  const cachedInputTokens = numberValue(
    inputDetails.cached_tokens ?? usage.cached_input_tokens ?? usage.input_cached_tokens,
  );
  const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

export function normalizeAnthropicUsage(value: unknown): RuntimeUsage | undefined {
  const usage = objectValue(value);
  const uncachedInputTokens = numberValue(usage.input_tokens);
  const cachedInputTokens = numberValue(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = numberValue(usage.cache_creation_input_tokens);
  const inputParts = [uncachedInputTokens, cachedInputTokens, cacheCreationInputTokens]
    .filter((count): count is number => count !== undefined);
  const inputTokens = inputParts.length ? inputParts.reduce((total, count) => total + count, 0) : undefined;
  const outputTokens = numberValue(usage.output_tokens);
  const totalTokens = inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

export function doneEvent(finishReason?: string): ModelStreamEvent {
  return { type: 'done', finishReason };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseToolInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) return {};
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return {};
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

function openAiChatContentParts(message: RuntimeMessage): unknown[] {
  return [
    ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
    ...inlineAttachments(message).map((attachment) => ({
      type: 'image_url',
      image_url: { url: attachment.url },
    })),
  ];
}

function toolVisualMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    role: 'user',
    content: `Image output from tool ${message.toolName || 'tool'}:`,
  };
}

function openAiResponsesContentParts(message: RuntimeMessage): unknown {
  const attachments = inlineAttachments(message);
  if (!attachments.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: 'input_text', text: message.content }] : []),
    ...attachments.map((attachment) => ({
      type: 'input_image',
      image_url: attachment.url,
    })),
  ];
}

function anthropicUserContentParts(message: RuntimeMessage): unknown {
  const attachments = inlineAttachments(message);
  if (!attachments.length) return message.content;
  const blocks: unknown[] = [];
  if (message.content.trim()) blocks.push({ type: 'text', text: message.content });
  for (const attachment of attachments) {
    const data = parseDataUrl(attachment.url);
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

function inlineAttachments(message: RuntimeMessage) {
  return (message.attachments ?? []).filter(
    (attachment): attachment is RuntimeInlineMessageAttachment =>
      isRuntimeInlineMessageAttachment(attachment)
      && attachment.modelVisible !== false
      && attachment.type.startsWith('image/'),
  );
}

function parseDataUrl(value: string): { mediaType: string; base64: string } | null {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}
