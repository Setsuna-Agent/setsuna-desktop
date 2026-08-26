import { getSupportedThinkingLevels, type Api, type Model, type Provider } from '@earendil-works/pi-ai';
import { antLingProvider } from '@earendil-works/pi-ai/providers/ant-ling';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { basetenProvider } from '@earendil-works/pi-ai/providers/baseten';
import { cerebrasProvider } from '@earendil-works/pi-ai/providers/cerebras';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { fireworksProvider } from '@earendil-works/pi-ai/providers/fireworks';
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { huggingfaceProvider } from '@earendil-works/pi-ai/providers/huggingface';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax';
import { minimaxCnProvider } from '@earendil-works/pi-ai/providers/minimax-cn';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { nvidiaProvider } from '@earendil-works/pi-ai/providers/nvidia';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { qwenTokenPlanProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan';
import { qwenTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan-cn';
import { qwenTokenPlanIndividualProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan-individual';
import { togetherProvider } from '@earendil-works/pi-ai/providers/together';
import { vercelAIGatewayProvider } from '@earendil-works/pi-ai/providers/vercel-ai-gateway';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { xiaomiProvider } from '@earendil-works/pi-ai/providers/xiaomi';
import { xiaomiTokenPlanAmsProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-ams';
import { xiaomiTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn';
import { xiaomiTokenPlanSgpProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';
import type {
  ModelProviderCatalog,
  ModelProviderCatalogModel,
  ModelProviderCatalogPlan,
  ModelProviderRuntimeConfig,
} from '../contracts/index.js';

const API_KIND = Object.freeze({
  'openai-completions': 'openai-compatible',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic',
} as const);

const KIND_API = Object.freeze({
  'openai-compatible': 'openai-completions',
  'openai-responses': 'openai-responses',
  anthropic: 'anthropic-messages',
} as const);

const PROVIDER_PRIORITY = [
  'openai',
  'anthropic',
  'deepseek',
  'xai',
  'groq',
  'openrouter',
] as const;

const SUPPORTED_PROVIDER_FACTORIES = Object.freeze([
  antLingProvider,
  anthropicProvider,
  basetenProvider,
  cerebrasProvider,
  deepseekProvider,
  fireworksProvider,
  githubCopilotProvider,
  groqProvider,
  huggingfaceProvider,
  kimiCodingProvider,
  minimaxProvider,
  minimaxCnProvider,
  moonshotaiProvider,
  moonshotaiCnProvider,
  nvidiaProvider,
  openaiProvider,
  opencodeGoProvider,
  openrouterProvider,
  qwenTokenPlanProvider,
  qwenTokenPlanCnProvider,
  qwenTokenPlanIndividualProvider,
  togetherProvider,
  vercelAIGatewayProvider,
  xaiProvider,
  xiaomiProvider,
  xiaomiTokenPlanAmsProvider,
  xiaomiTokenPlanCnProvider,
  xiaomiTokenPlanSgpProvider,
  zaiProvider,
  zaiCodingCnProvider,
]);

let supportedProvidersCache: readonly Provider[] | undefined;

export function createModelProviderCatalog(): ModelProviderCatalog {
  const providers = supportedProviders().flatMap((runtimeProvider) => {
    if (!runtimeProvider.auth.apiKey) return [];

    const plansByKey = new Map<string, { api: keyof typeof API_KIND; baseUrl: string; models: Model<Api>[] }>();
    for (const model of runtimeProvider.getModels()) {
      if (!isSupportedApi(model.api) || !isSimpleBaseUrl(model.baseUrl)) continue;
      const key = `${model.api}\u0000${normalizeBaseUrl(model.baseUrl)}`;
      const group = plansByKey.get(key) ?? { api: model.api, baseUrl: model.baseUrl, models: [] };
      group.models.push(model);
      plansByKey.set(key, group);
    }

    const plans = [...plansByKey.values()].map((group, index): ModelProviderCatalogPlan => ({
      id: `${runtimeProvider.id}:${group.api}${index ? `:${index + 1}` : ''}`,
      name: planName(group.api),
      provider: API_KIND[group.api],
      baseUrl: group.baseUrl,
      models: group.models.map(catalogModel),
    }));
    if (!plans.length) return [];
    return [{ id: runtimeProvider.id, name: runtimeProvider.name, plans }];
  });

  providers.sort((left, right) => {
    const leftPriority = providerPriority(left.id);
    const rightPriority = providerPriority(right.id);
    return leftPriority - rightPriority || left.name.localeCompare(right.name, 'en');
  });
  return { providers };
}

export function getBuiltinCatalogModel(providerId: string, modelId: string): Model<Api> | undefined {
  return getBuiltinCatalogProvider(providerId)?.getModels().find((model) => model.id === modelId);
}

export function getBuiltinCatalogProvider(providerId: string): Provider | undefined {
  return supportedProviders().find((provider) => provider.id === providerId);
}

/** Preserve an explicit custom-service choice while still migrating legacy records without catalog identity. */
export function builtinCatalogProviderIdForConfig(
  provider: Pick<ModelProviderRuntimeConfig, 'baseUrl' | 'catalogProviderId' | 'provider'>,
): string | undefined {
  if (provider.catalogProviderId === null) return undefined;
  return provider.catalogProviderId ?? inferBuiltinCatalogProviderId(provider);
}

/**
 * Legacy provider records predate catalogProviderId. An exact protocol/base-URL match restores
 * Pi's provider-specific compatibility without changing genuinely custom endpoints.
 */
export function inferBuiltinCatalogProviderId(
  provider: Pick<ModelProviderRuntimeConfig, 'baseUrl' | 'provider'>,
): string | undefined {
  const api = KIND_API[provider.provider];
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const matches = supportedProviders().filter((candidate) => (
    candidate.getModels().some((model) => (
      model.api === api && normalizeBaseUrl(model.baseUrl) === baseUrl
    ))
  ));
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function supportedProviders(): readonly Provider[] {
  supportedProvidersCache ??= Object.freeze(SUPPORTED_PROVIDER_FACTORIES.map((factory) => factory()));
  return supportedProvidersCache;
}

function catalogModel(model: Model<Api>): ModelProviderCatalogModel {
  const thinkingEfforts = getSupportedThinkingLevels(model).filter((level) => level !== 'off');
  const defaultThinkingEffort = preferredThinkingEffort(thinkingEfforts);
  return {
    code: model.id,
    name: model.name,
    contextWindowTokens: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    thinkingEnabled: model.reasoning,
    thinkingEfforts,
    ...(defaultThinkingEffort ? { defaultThinkingEffort } : {}),
    supportsImages: model.input.includes('image'),
  };
}

function preferredThinkingEffort(efforts: readonly string[]): string | undefined {
  return ['medium', 'high', 'low', 'minimal', 'xhigh', 'max'].find((effort) => efforts.includes(effort));
}

function isSupportedApi(api: string): api is keyof typeof API_KIND {
  return Object.hasOwn(API_KIND, api);
}

function isSimpleBaseUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && !/[{}]/u.test(value);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '').toLocaleLowerCase();
}

function planName(api: keyof typeof API_KIND): string {
  if (api === 'openai-responses') return 'OpenAI Responses';
  if (api === 'anthropic-messages') return 'Anthropic Messages';
  return 'OpenAI Chat Completions';
}

function providerPriority(providerId: string): number {
  const index = PROVIDER_PRIORITY.indexOf(providerId as typeof PROVIDER_PRIORITY[number]);
  return index < 0 ? PROVIDER_PRIORITY.length : index;
}
