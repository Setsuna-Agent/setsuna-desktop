import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';

type ThinkingService = {
  thinkingEnabled: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort?: string;
  maxOutputTokens?: number;
};

export function openAiCompatibleThinkingBody(provider: RuntimeProviderConfig, request: ModelRequest): Record<string, unknown> {
  const effort = thinkingEffortForRequest(thinkingService(provider), request);
  // OpenAI-compatible 供应商统一使用 reasoning_effort；未开启时不覆盖模型默认行为。
  return effort ? { reasoning_effort: effort } : {};
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
  const effort = thinkingEffortForRequest(thinkingService(provider), request);
  return effort ? { reasoning: { effort } } : {};
}

export function anthropicThinkingBody(provider: RuntimeProviderConfig, request: ModelRequest): Record<string, unknown> | null {
  const service = thinkingService(provider);
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
  const reasoningEffort = nonEmptyString(request.reasoningEffort) ?? nonEmptyString(thinkingEffortForRequest(thinkingService(provider), request));
  return {
    thinking: true,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
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

function thinkingService(provider: RuntimeProviderConfig): ThinkingService {
  const model = provider.activeModel;
  return {
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
