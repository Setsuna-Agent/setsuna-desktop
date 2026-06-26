import type { ModelRequest, RuntimeToolCall, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../ports/model-client.js';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  arrayValue,
  assertOkResponse,
  doneEvent,
  normalizeOpenAiUsage,
  objectValue,
  parseJson,
  parseSse,
  requireFetch,
  stringValue,
  toOpenAiMessages,
  withEndpoint,
  type FetchImpl,
} from './provider-utils.js';
import { openAiCompatibleThinkingBody } from './provider-thinking.js';

export class OpenAiChatModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest) {
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.provider.apiKey}`,
      },
      signal: request.signal,
      body: JSON.stringify({
        model: activeModel?.code || request.model,
        messages: toOpenAiMessages(request.messages),
        stream: true,
        max_tokens: request.maxOutputTokens ?? activeModel?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
        ...(request.tools?.length ? { tools: toOpenAiChatTools(request.tools) } : {}),
        ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
        ...openAiCompatibleThinkingBody(this.provider, request),
      }),
    });
    await assertOkResponse(response, 'OpenAI compatible request failed');

    const toolCallsByIndex = new Map<number, RuntimeToolCall>();
    let usage = undefined;
    let finishReason = undefined;
    let toolCallsYielded = false;
    for await (const { data } of parseSse(response)) {
      if (data === '[DONE]') break;
      const payload = objectValue(parseJson(data));
      if (payload.usage) usage = normalizeOpenAiUsage(payload.usage);
      for (const choice of arrayValue(payload.choices)) {
        const choiceObject = objectValue(choice);
        const delta = objectValue(choiceObject.delta);
        const text = stringValue(delta.content);
        const reasoning = stringValue(delta.reasoning_content ?? delta.reasoning);
        if (reasoning) yield { type: 'reasoning_delta' as const, text: reasoning };
        if (text) yield { type: 'text_delta' as const, text };
        for (const toolCallDelta of arrayValue(delta.tool_calls)) {
          const parsed = mergeToolCallDelta(toolCallsByIndex, toolCallDelta);
          if (parsed) yield { type: 'tool_call_delta' as const, call: parsed };
        }
        const reason = stringValue(choiceObject.finish_reason);
        if (reason === 'tool_calls') {
          const toolCalls = [...toolCallsByIndex.values()].filter((call) => call.name);
          if (toolCalls.length) {
            toolCallsYielded = true;
            yield { type: 'tool_calls' as const, toolCalls };
          }
        }
        if (reason) finishReason = reason;
      }
    }
    if (!toolCallsYielded && toolCallsByIndex.size) {
      const toolCalls = [...toolCallsByIndex.values()].filter((call) => call.name);
      if (toolCalls.length) yield { type: 'tool_calls' as const, toolCalls };
    }
    if (usage) yield { type: 'usage' as const, usage: { ...usage, provider: this.provider.provider, model: activeModel?.code } };
    yield doneEvent(finishReason);
  }
}

function toOpenAiChatTools(tools: RuntimeToolDefinition[]) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function mergeToolCallDelta(toolCallsByIndex: Map<number, RuntimeToolCall>, value: unknown) {
  const item = objectValue(value);
  const index = typeof item.index === 'number' ? item.index : toolCallsByIndex.size;
  const existing = toolCallsByIndex.get(index) ?? {
    id: stringValue(item.id) || `tool_call_${index}`,
    name: '',
    arguments: '',
  };
  const fn = objectValue(item.function);
  const name = stringValue(fn.name);
  const argumentDelta = stringValue(fn.arguments);
  const next = {
    id: stringValue(item.id) || existing.id,
    name: name || existing.name,
    arguments: `${existing.arguments}${argumentDelta}`,
  };
  toolCallsByIndex.set(index, next);
  if (!argumentDelta && !name) return null;
  return {
    id: next.id,
    name: next.name,
    argumentsDelta: argumentDelta,
  };
}
