import {
  defaultModelMaxOutputTokens,
  type BrandIconConfig,
  type ProviderConfigState,
  type ProviderModelConfig,
  type RuntimeAvailableModel,
  type RuntimeConfigState,
} from '@setsuna-desktop/contracts';

const DEFAULT_PROVIDER_KIND: ProviderConfigState['provider'] = 'openai-compatible';
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const providerProtocolOptions: Array<{ value: ProviderConfigState['provider']; label: string; meta: string; placeholder: string }> = [
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible',
    meta: 'OpenAI-compatible · AI SDK',
    placeholder: 'http://127.0.0.1:11434/v1',
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    meta: 'OpenAI Responses · /responses',
    placeholder: 'https://api.openai.com/v1',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    meta: 'Anthropic · /v1/messages',
    placeholder: 'https://api.anthropic.com',
  },
];

export function selectedProviderIdFromConfig(config: RuntimeConfigState): string {
  return selectedProviderIdFromProviders(config.activeProviderId, config.providers);
}

function activeSettingsProvider(config: RuntimeConfigState): ProviderConfigState | undefined {
  const providerId = selectedProviderIdFromConfig(config);
  return config.providers.find((provider) => provider.id === providerId);
}

export function memoryExtractModelOptions(config: RuntimeConfigState): Array<{ value: string; label: string }> {
  const provider = activeSettingsProvider(config);
  if (!provider?.enabled) return [];
  const seen = new Set<string>();
  return provider.models.reduce<Array<{ value: string; label: string }>>((options, model) => {
    const code = model.code.trim();
    if (!code || seen.has(code)) return options;
    seen.add(code);
    options.push({
      value: code,
      label: model.name && model.name !== code ? `${model.name} (${code})` : code,
    });
    return options;
  }, []);
}

export function selectedProviderIdFromProviders(activeProviderId: string | undefined, providers: ProviderConfigState[]): string {
  return providers.find((provider) => provider.id === activeProviderId && provider.enabled)?.id ?? providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id ?? '';
}

export function hasProviderModel(providers: ProviderConfigState[], providerId: string, modelId: string): boolean {
  return providers.some((provider) => provider.id === providerId && provider.models.some((model) => model.id === modelId));
}

export function normalizeSettingsProviders(providers: ProviderConfigState[]): ProviderConfigState[] {
  const normalized = (providers.length ? providers : [defaultProviderConfig()]).map((provider) => {
    const providerKind = normalizeProviderKind(provider.provider);
    return {
      ...provider,
      provider: providerKind,
      name: provider.name || '模型服务',
      models: normalizeProviderModels(provider.models, providerKind),
    };
  });
  return normalized.length ? normalized : [defaultProviderConfig()];
}

export function normalizeProviderModels(models: ProviderModelConfig[], provider: ProviderConfigState['provider']): ProviderModelConfig[] {
  const normalized = (models.length ? models : [defaultProviderModel('', true, provider)])
    .map((model, index) => normalizeProviderModel(model, index === 0, provider));
  const activeModelId = normalized.find((model) => model.enabled)?.id ?? normalized[0]?.id;
  return normalized.map((model) => ({ ...model, enabled: model.id === activeModelId }));
}

export function normalizeProviderModel(model: ProviderModelConfig, fallbackEnabled = false, provider: ProviderConfigState['provider'] = DEFAULT_PROVIDER_KIND): ProviderModelConfig {
  const code = model.code?.trim() ?? '';
  const thinkingEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]);
  return {
    ...model,
    id: model.id || modelIdFromCode(code),
    name: model.name || code || '新模型',
    code,
    enabled: model.enabled ?? fallbackEnabled,
    maxOutputTokens: positiveInt(model.maxOutputTokens, defaultModelMaxOutputTokens(provider)),
    contextWindowTokens: model.contextWindowTokens ? positiveInt(model.contextWindowTokens, 0) || undefined : undefined,
    thinkingEnabled: Boolean(model.thinkingEnabled),
    thinkingEfforts,
    defaultThinkingEffort: model.thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
    supportsImages: Boolean(model.supportsImages),
  };
}

export function defaultProviderConfig(): ProviderConfigState {
  return {
    id: uniqueLocalId('provider'),
    name: '新模型服务',
    provider: DEFAULT_PROVIDER_KIND,
    baseUrl: 'http://127.0.0.1:11434/v1',
    enabled: true,
    apiKeySet: false,
    apiKeyPreview: '',
    models: [defaultProviderModel('', true, DEFAULT_PROVIDER_KIND)],
  };
}

export function defaultProviderModel(code: string, enabled = true, provider: ProviderConfigState['provider'] = DEFAULT_PROVIDER_KIND): ProviderModelConfig {
  return {
    id: modelIdFromCode(code),
    name: code || '新模型',
    code,
    enabled,
    maxOutputTokens: defaultModelMaxOutputTokens(provider),
    thinkingEnabled: false,
    thinkingEfforts: [],
    supportsImages: false,
  };
}

export function prepareProviderForSave(provider: ProviderConfigState): ProviderConfigState {
  return {
    ...provider,
    provider: normalizeProviderKind(provider.provider),
    models: normalizeProviderModels(provider.models, provider.provider).map((model) => ({
      ...model,
      defaultThinkingEffort: normalizedDefaultThinkingEffort(model),
    })),
  };
}

export function providerWithIcon(provider: ProviderConfigState, icon: BrandIconConfig | undefined): ProviderConfigState {
  if (icon) return { ...provider, icon };
  const nextProvider = { ...provider };
  delete nextProvider.icon;
  return nextProvider;
}

export function modelWithIcon(model: ProviderModelConfig, icon: BrandIconConfig | undefined): ProviderModelConfig {
  if (icon) return { ...model, icon };
  const nextModel = { ...model };
  delete nextModel.icon;
  return nextModel;
}

export function normalizeProviderKind(value: unknown): ProviderConfigState['provider'] {
  return providerProtocolOptions.find((option) => option.value === value)?.value ?? DEFAULT_PROVIDER_KIND;
}

export function providerProtocolLabel(provider: ProviderConfigState['provider']): string {
  return providerProtocolOption(provider).label;
}

export function providerProtocolMeta(provider: ProviderConfigState['provider']): string {
  return providerProtocolOption(provider).meta;
}

export function providerBaseUrlPlaceholder(provider: ProviderConfigState['provider']): string {
  return providerProtocolOption(provider).placeholder;
}

function providerProtocolOption(provider: ProviderConfigState['provider']) {
  return providerProtocolOptions.find((option) => option.value === provider) ?? providerProtocolOptions[0];
}

export function providerApiKeyPlaceholder(provider: ProviderConfigState): string {
  if (provider.apiKeySet) return '留空则保留当前密钥';
  return provider.provider === 'openai-compatible' ? '本地服务可留空' : '本地兼容服务可留空';
}

export function ensureProviderActiveModel(provider: ProviderConfigState): ProviderConfigState {
  return { ...provider, models: normalizeProviderModels(provider.models, provider.provider) };
}

export function mergeFetchedModels(previousModels: ProviderModelConfig[], fetchedModels: RuntimeAvailableModel[], provider: ProviderConfigState['provider']): ProviderModelConfig[] {
  const previousByCode = new Map(previousModels.map((model) => [model.code, model]));
  const previousByName = new Map(previousModels.map((model) => [model.name, model]));
  const previousActiveCode = previousModels.find((model) => model.enabled)?.code;
  const activeCode = fetchedModels.some((model) => model.id === previousActiveCode) ? previousActiveCode : fetchedModels[0]?.id;
  const merged = fetchedModels.map((model) => {
    const previous = previousByCode.get(model.id) ?? previousByName.get(model.name);
    const code = model.id.trim();
    const thinkingEfforts = normalizeThinkingEfforts([...(previous?.thinkingEfforts ?? []), ...(model.thinkingEfforts ?? []), previous?.defaultThinkingEffort, model.defaultThinkingEffort]);
    const defaultThinkingEffort = nonEmptyString(previous?.defaultThinkingEffort) ?? nonEmptyString(model.defaultThinkingEffort);
    return normalizeProviderModel(
      {
        ...defaultProviderModel(code, code === activeCode, provider),
        id: previous?.id || modelIdFromCode(code),
        name: model.name?.trim() || code,
        ...(previous?.icon ? { icon: previous.icon } : {}),
        maxOutputTokens: previous?.maxOutputTokens ?? model.maxOutputTokens ?? defaultModelMaxOutputTokens(provider),
        thinkingEnabled: Boolean(previous?.thinkingEnabled || model.thinkingEnabled || thinkingEfforts.length || defaultThinkingEffort),
        thinkingEfforts,
        defaultThinkingEffort,
        supportsImages: Boolean(previous?.supportsImages || model.supportsImages),
      },
      code === activeCode,
      provider,
    );
  });
  return normalizeProviderModels(merged, provider);
}

export function updateModelCode(model: ProviderModelConfig, code: string): ProviderModelConfig {
  const trimmed = code.trim();
  return {
    ...model,
    code,
    name: model.name && model.name !== model.code ? model.name : trimmed,
  };
}

export function setThinkingEnabled(model: ProviderModelConfig, thinkingEnabled: boolean): ProviderModelConfig {
  const thinkingEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]);
  return {
    ...model,
    thinkingEnabled,
    thinkingEfforts,
    defaultThinkingEffort: thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
  };
}

function setThinkingEfforts(model: ProviderModelConfig, efforts: unknown): ProviderModelConfig {
  const thinkingEfforts = normalizeThinkingEfforts(efforts);
  return {
    ...model,
    thinkingEfforts,
    defaultThinkingEffort: model.thinkingEnabled ? normalizeDefaultThinkingEffort({ ...model, thinkingEfforts }) : undefined,
  };
}

export function setCustomThinkingEfforts(model: ProviderModelConfig, customEfforts: unknown): ProviderModelConfig {
  const presetEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]).filter(isReasoningEffort);
  return setThinkingEfforts(model, [...presetEfforts, ...normalizeThinkingEfforts(customEfforts)]);
}

export function toggleThinkingEffort(model: ProviderModelConfig, effort: string): ProviderModelConfig {
  const normalizedEffort = nonEmptyString(effort);
  if (!normalizedEffort) return model;
  const currentEfforts = normalizeThinkingEfforts([...model.thinkingEfforts, model.defaultThinkingEffort]);
  const nextEfforts = currentEfforts.includes(normalizedEffort) ? currentEfforts.filter((item) => item !== normalizedEffort) : [...currentEfforts, normalizedEffort];
  return setThinkingEfforts(model, nextEfforts);
}

function normalizedDefaultThinkingEffort(model: ProviderModelConfig): string | undefined {
  if (!model.thinkingEnabled) return undefined;
  return normalizeDefaultThinkingEffort(model);
}

function normalizeDefaultThinkingEffort(model: Pick<ProviderModelConfig, 'defaultThinkingEffort' | 'thinkingEfforts'>): string | undefined {
  const thinkingEfforts = normalizeThinkingEfforts(model.thinkingEfforts);
  const defaultThinkingEffort = nonEmptyString(model.defaultThinkingEffort);
  if (defaultThinkingEffort && thinkingEfforts.includes(defaultThinkingEffort)) return defaultThinkingEffort;
  return thinkingEfforts[0];
}

export function normalizeThinkingEfforts(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : [];
  const seen = new Set<string>();
  const efforts: string[] = [];
  for (const rawValue of rawValues) {
    const effort = nonEmptyString(rawValue);
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    efforts.push(effort);
  }
  return efforts;
}

export function thinkingPresetOptionsForModel(): string[] {
  return normalizeThinkingEfforts(REASONING_EFFORTS);
}

export function customThinkingEfforts(efforts: string[]): string[] {
  return normalizeThinkingEfforts(efforts).filter((effort) => !isReasoningEffort(effort));
}

function isReasoningEffort(effort: string): boolean {
  return (REASONING_EFFORTS as readonly string[]).includes(effort);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function modelIdFromCode(code: string): string {
  return code.trim() || uniqueLocalId('model');
}

function uniqueLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}
