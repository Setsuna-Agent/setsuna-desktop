import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';

type ThinkingService = {
  provider: string;
  baseUrl: string;
  model: string;
  thinkingEnabled: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort?: string;
  maxOutputTokens?: number;
};

export function openAiCompatibleThinkingBody(provider: RuntimeProviderConfig, request: ModelRequest): Record<string, unknown> {
  const service = thinkingService(provider, request.model);
  switch (openAiProviderFamily(service)) {
    case 'siliconflow':
      return siliconFlowThinkingParams(service, request);
    case 'mimo':
      return xiaomiMiMoThinkingParams(service, request);
    case 'ark':
      return volcengineArkThinkingParams(service, request);
    case 'qwen':
      return qwenThinkingParams(service, request);
    case 'minimax':
      return miniMaxThinkingParams(service, request);
    case 'deepseek':
      return deepSeekThinkingParams(service, request);
    default:
      return openAiReasoningEffortParams(service, request);
  }
}

export function openAiCompatibleAiSdkProviderOptions(provider: RuntimeProviderConfig, request: ModelRequest): Record<string, unknown> {
  const body = openAiCompatibleThinkingBody(provider, request);
  if (!Object.keys(body).length) return {};
  const { reasoning_effort: reasoningEffort, ...rest } = body;
  return {
    ...rest,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

export function openAiResponsesReasoningBody(provider: RuntimeProviderConfig, request: ModelRequest): Record<string, unknown> {
  const effort = thinkingEffortForRequest(thinkingService(provider, request.model), request);
  return effort ? { reasoning: { effort } } : {};
}

export function anthropicThinkingBody(provider: RuntimeProviderConfig, request: ModelRequest): Record<string, unknown> | null {
  const service = thinkingService(provider, request.model);
  const effort = thinkingEffortForRequest(service, request);
  if (!effort) return null;
  const normalized = effort.toLowerCase();
  if (normalized === 'adaptive' || normalized === 'auto') return { type: 'adaptive' };
  const budgetTokens = anthropicThinkingBudgetForEffort(normalized, service.maxOutputTokens);
  return budgetTokens ? { type: 'enabled', budget_tokens: budgetTokens } : null;
}

export function thinkingRequestDefaults(provider: RuntimeProviderConfig, request: ModelRequest): Pick<ModelRequest, 'thinking' | 'reasoningEffort'> {
  const thinking = request.thinking === true;
  if (!thinking) return { thinking: false };
  const reasoningEffort = nonEmptyString(request.reasoningEffort) ?? nonEmptyString(thinkingEffortForRequest(thinkingService(provider, request.model), request));
  return {
    thinking: true,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function miniMaxThinkingParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  if (!service.thinkingEnabled) return {};
  if (!requestWantsThinking(request)) return { thinking: { type: 'disabled' } };
  return {
    thinking: { type: 'adaptive' },
    reasoning_split: true,
  };
}

function siliconFlowThinkingParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  if (!service.thinkingEnabled) return {};
  const params: Record<string, unknown> = {
    ...openAiReasoningEffortParams(service, request),
    enable_thinking: requestWantsThinking(request),
  };
  const budget = numericThinkingBudgetForRequest(service, request);
  if (requestWantsThinking(request) && budget) params.thinking_budget = budget;
  return params;
}

function xiaomiMiMoThinkingParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  if (!service.thinkingEnabled) return {};
  return {
    ...openAiReasoningEffortParams(service, request),
    thinking: { type: requestWantsThinking(request) ? 'enabled' : 'disabled' },
  };
}

function volcengineArkThinkingParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  if (!service.thinkingEnabled) return {};
  const rawEffort = thinkingEffortForRequest(service, request).toLowerCase();
  const params: Record<string, unknown> = {
    thinking: { type: requestWantsThinking(request) ? arkThinkingTypeFromEffort(rawEffort) : 'disabled' },
  };
  const effort = arkReasoningEffort(rawEffort);
  if (requestWantsThinking(request) && effort) params.reasoning_effort = effort;
  return params;
}

function qwenThinkingParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  if (!service.thinkingEnabled) return {};
  return {
    ...openAiReasoningEffortParams(service, request),
    enable_thinking: requestWantsThinking(request),
  };
}

function deepSeekThinkingParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  if (!service.thinkingEnabled) return {};
  const effort = thinkingEffortForRequest(service, request);
  const thinking: Record<string, unknown> = {
    type: requestWantsThinking(request) ? 'enabled' : 'disabled',
  };
  if (requestWantsThinking(request) && effort) thinking.reasoning_effort = effort;
  return {
    ...(requestWantsThinking(request) && effort ? { reasoning_effort: effort } : {}),
    thinking,
  };
}

function openAiReasoningEffortParams(service: ThinkingService, request: ModelRequest): Record<string, unknown> {
  const effort = thinkingEffortForRequest(service, request);
  return effort ? { reasoning_effort: effort } : {};
}

function thinkingEffortForRequest(service: ThinkingService, request: ModelRequest): string {
  if (!service.thinkingEnabled || !requestWantsThinking(request)) return '';
  return nonEmptyString(request.reasoningEffort)
    ?? nonEmptyString(service.defaultThinkingEffort)
    ?? firstString(service.thinkingEfforts)
    ?? '';
}

function requestWantsThinking(request: ModelRequest): boolean {
  if (request.thinking === false) return false;
  return request.thinking === true || Boolean(nonEmptyString(request.reasoningEffort));
}

function numericThinkingBudgetForRequest(service: ThinkingService, request: ModelRequest): number {
  const budget = Number(thinkingEffortForRequest(service, request));
  return Number.isFinite(budget) && budget > 0 ? Math.round(budget) : 0;
}

function anthropicThinkingBudgetForEffort(effort: string, maxOutputTokens: number | undefined): number {
  const maxTokens = boundedPositiveInt(maxOutputTokens, 68000);
  if (maxTokens <= 1024) return 0;
  if (effort === 'max') return Math.max(1024, maxTokens - 1);
  const mapped = {
    minimal: 1024,
    low: 2048,
    medium: 4096,
    high: 8192,
    xhigh: 16384,
  }[effort];
  const requested = mapped || boundedPositiveInt(Number(effort), 0);
  if (!requested) return 0;
  return Math.max(1024, Math.min(requested, maxTokens - 1));
}

function arkThinkingTypeFromEffort(effort: string): string {
  if (effort === 'enabled' || effort === 'disabled' || effort === 'auto') return effort;
  if (effort === 'minimal' || effort === 'none') return 'disabled';
  return 'enabled';
}

function arkReasoningEffort(effort: string): string {
  if (!effort) return '';
  if (effort === 'none') return 'minimal';
  if (effort === 'xhigh' || effort === 'max') return 'high';
  return effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high' ? effort : '';
}

function openAiProviderFamily(service: ThinkingService): 'ark' | 'deepseek' | 'mimo' | 'minimax' | 'openai' | 'qwen' | 'siliconflow' {
  const value = [
    service.provider,
    service.baseUrl,
    service.model,
  ].map((item) => item.toLowerCase()).join(' ');
  if (value.includes('siliconflow') || value.includes('siliconflow.cn') || value.includes('硅基流动')) return 'siliconflow';
  if (['xiaomi', 'xiaomimimo', 'mimo-v2', '小米'].some((keyword) => value.includes(keyword))) return 'mimo';
  if (['volcengine', 'volces', 'ark.cn-beijing', 'doubao', '火山', '方舟', '豆包'].some((keyword) => value.includes(keyword))) return 'ark';
  if (['qwen', 'dashscope', 'aliyun', 'alibaba', 'tongyi', '通义', '千问'].some((keyword) => value.includes(keyword))) return 'qwen';
  if (value.includes('minimax') || value.includes('minimaxi')) return 'minimax';
  if (value.includes('deepseek')) return 'deepseek';
  return 'openai';
}

function thinkingService(provider: RuntimeProviderConfig, modelId: string): ThinkingService {
  const model = provider.activeModel;
  return {
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    model: model?.code || modelId,
    thinkingEnabled: model?.thinkingEnabled === true,
    thinkingEfforts: Array.isArray(model?.thinkingEfforts) ? model.thinkingEfforts : [],
    defaultThinkingEffort: model?.defaultThinkingEffort,
    maxOutputTokens: model?.maxOutputTokens,
  };
}

function firstString(values: unknown[]): string | undefined {
  return values.map(nonEmptyString).find(Boolean);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
