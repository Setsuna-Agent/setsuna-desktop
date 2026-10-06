import type { BrandIconConfig, ProviderConfigState, ProviderModelConfig } from '@setsuna-desktop/contracts';
import type { Translate } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import setsunaAppIconUrl from '../assets/setsuna-app.png';
import glmLogoUrl from '../assets/provider-logos/glm.png';
import kimiDarkLogoUrl from '../assets/provider-logos/kimi-dark.svg';
import kimiLogoUrl from '../assets/provider-logos/kimi.svg';
import sakanaLogoUrl from '../assets/provider-logos/sakana.svg';
import { createBrandNameMatcher } from './brandNameMatcher.js';
import { LIBRARY_BRAND_CATALOG, libraryProviderBrand } from './providerBrandLibrary.js';

type ProviderBrandMatchInput = Pick<ProviderConfigState, 'baseUrl' | 'catalogProviderId' | 'name'>;
type ProviderBrandInput = ProviderBrandMatchInput & Pick<ProviderConfigState, 'icon'>;
type ModelBrandInput = Pick<ProviderModelConfig, 'code' | 'icon' | 'name'>;

export type ProviderBrandAsset = {
  darkSrc?: string;
  key: string;
  label: string;
  monochrome: boolean;
  searchText?: string;
  src: string;
};

type ProviderBrandRule = ProviderBrandAsset & {
  nameKeywords: readonly string[];
  urlKeywords?: readonly string[];
};

type ProviderBrandRuleOptions = {
  darkSrc?: string;
  monochrome?: boolean;
  src?: string;
  urlKeywords?: readonly string[];
};

type ModelBrandRule = {
  key: string;
  patterns: readonly RegExp[];
};

const providerBrandRules: readonly ProviderBrandRule[] = [
  brandRule('setsuna', 'Setsuna', ['setsuna'], { src: setsunaAppIconUrl, monochrome: false }),
  brandRule('minimax', 'MiniMax', ['minimax', '海螺'], {
    monochrome: false,
    urlKeywords: ['minimaxi.com', 'minimax.io', 'minimax.chat'],
  }),
  brandRule('kimi', 'Kimi', ['kimi', 'moonshot', '月之暗面'], {
    src: kimiLogoUrl,
    darkSrc: kimiDarkLogoUrl,
    monochrome: false,
    urlKeywords: ['moonshot.cn', 'moonshot.ai', 'kimi.com'],
  }),
  brandRule('deepseek', 'DeepSeek', ['deepseek', '深度求索'], {
    monochrome: false,
    urlKeywords: ['deepseek.com'],
  }),
  brandRule('glm', '智谱 GLM', ['zhipu', '智谱', 'chatglm', 'glm', 'z.ai'], {
    src: glmLogoUrl,
    monochrome: false,
    urlKeywords: ['bigmodel.cn', 'api.z.ai'],
  }),
  brandRule('sakana', 'Sakana AI', ['sakana'], { src: sakanaLogoUrl, monochrome: false, urlKeywords: ['sakana.ai'] }),
  brandRule('qwen', 'Qwen', ['qwen', '通义千问', '千问'], { monochrome: false, urlKeywords: ['qwen'] }),
  brandRule('doubao', '豆包', ['doubao', '豆包'], { monochrome: false, urlKeywords: ['doubao'] }),
  brandRule('bailian', '阿里云百炼', ['bailian', '百炼', '阿里云', 'alibaba cloud', 'aliyun'], {
    monochrome: false,
    urlKeywords: ['dashscope.aliyuncs.com'],
  }),
  brandRule('volcengine', '火山引擎', ['volcengine', '火山引擎', '火山方舟'], {
    monochrome: false,
    urlKeywords: ['volces.com', 'volcengine.com'],
  }),
  brandRule('siliconcloud', '硅基流动', ['siliconcloud', 'siliconflow', '硅基流动'], {
    monochrome: false,
    urlKeywords: ['siliconflow.cn'],
  }),
  brandRule('openai', 'OpenAI', ['openai', 'chatgpt'], { urlKeywords: ['api.openai.com'] }),
  brandRule('anthropic', 'Anthropic', ['anthropic', 'claude'], { urlKeywords: ['anthropic.com'] }),
  brandRule('gemini', 'Google Gemini', ['gemini', 'google ai', 'google vertex'], {
    monochrome: false,
    urlKeywords: ['generativelanguage.googleapis.com', 'aiplatform.googleapis.com'],
  }),
  brandRule('ollama', 'Ollama', ['ollama'], { urlKeywords: [':11434'] }),
  brandRule('mistral', 'Mistral AI', ['mistral'], { monochrome: false, urlKeywords: ['mistral.ai'] }),
  brandRule('groq', 'Groq', ['groq'], { urlKeywords: ['groq.com'] }),
  brandRule('xai', 'xAI', ['xai', 'x.ai', 'grok'], { urlKeywords: ['api.x.ai'] }),
];

const modelBrandRules: readonly ModelBrandRule[] = [
  modelBrandRule('openai', /(^|[^a-z0-9])(?:openai|gpt|chatgpt|codex|o1|o3|o4)(?=$|[^a-z0-9])/),
  modelBrandRule('anthropic', /(^|[^a-z0-9])(?:anthropic|claude)(?=$|[^a-z0-9])/),
  modelBrandRule('gemini', /(^|[^a-z0-9])gemini(?=$|[^a-z0-9])/),
  modelBrandRule('deepseek', /(^|[^a-z0-9])deepseek(?=$|[^a-z0-9])/),
  modelBrandRule('glm', /(^|[^a-z0-9])(?:chatglm|glm)(?=$|[^a-z0-9])/),
  modelBrandRule('qwen', /(^|[^a-z0-9])(?:qwen(?:\d+(?:\.\d+)*)?|qwq)(?=$|[^a-z0-9])/),
  modelBrandRule('minimax', /(^|[^a-z0-9])minimax(?=$|[^a-z0-9])/),
  modelBrandRule('kimi', /(^|[^a-z0-9])(?:kimi|moonshot)(?=$|[^a-z0-9])/),
  modelBrandRule('mistral', /(^|[^a-z0-9])(?:mistral|mixtral|codestral)(?=$|[^a-z0-9])/),
  modelBrandRule('doubao', /(^|[^a-z0-9])doubao(?=$|[^a-z0-9])/),
  modelBrandRule('xai', /(^|[^a-z0-9])grok(?=$|[^a-z0-9])/),
  modelBrandRule('groq', /(^|[^a-z0-9])groq(?=$|[^a-z0-9])/),
  modelBrandRule('sakana', /(^|[^a-z0-9])sakana(?=$|[^a-z0-9])/),
];

const localizedBrandLabelKeys: Partial<Record<string, MessageKey>> = {
  bailian: 'settings.brand.catalog.bailian',
  custom: 'settings.brand.customImage',
  doubao: 'settings.brand.catalog.doubao',
  glm: 'settings.brand.catalog.glm',
  siliconcloud: 'settings.brand.catalog.siliconcloud',
  volcengine: 'settings.brand.catalog.volcengine',
};

const preferredBrands = providerBrandRules.map(providerBrandAsset);
const preferredBrandKeys = new Set(preferredBrands.map(({ key }) => key));
export const PROVIDER_BRAND_CATALOG: readonly ProviderBrandAsset[] = [
  ...preferredBrands,
  ...LIBRARY_BRAND_CATALOG.filter(({ key }) => !preferredBrandKeys.has(key))
    .sort((left, right) => left.label.localeCompare(right.label, 'en')),
];
const providerBrandsByKey = new Map(PROVIDER_BRAND_CATALOG.map((brand) => [brand.key, brand]));
const matchBrandName = createBrandNameMatcher(
  PROVIDER_BRAND_CATALOG,
  providerBrandRules.map(({ key, nameKeywords }) => ({ key, names: nameKeywords })),
);

export function searchProviderBrands(query: string, t: Translate): readonly ProviderBrandAsset[] {
  const terms = normalizeBrandText(query.normalize('NFKC')).split(/\s+/u).filter(Boolean);
  if (!terms.length) return PROVIDER_BRAND_CATALOG;
  return PROVIDER_BRAND_CATALOG.filter((brand) => {
    const text = normalizeBrandText(`${brand.key} ${brand.label} ${brand.searchText ?? ''} ${localizedProviderBrandLabel(brand, t)}`);
    return terms.every((term) => text.includes(term));
  });
}

export function localizedProviderBrandLabel(brand: ProviderBrandAsset, t: Translate): string {
  const key = localizedBrandLabelKeys[brand.key];
  return key ? t(key) : brand.label;
}

export function resolveProviderBrand(provider: ProviderBrandInput): ProviderBrandAsset | null {
  return resolveBrandIcon(provider.icon, resolveAutomaticProviderBrand(provider));
}

export function resolveModelBrand(model: ModelBrandInput, provider: ProviderBrandInput): ProviderBrandAsset | null {
  return resolveBrandIcon(model.icon, resolveAutomaticModelBrand(model, provider));
}

export function resolveBrandIcon(icon: BrandIconConfig | undefined, automaticBrand: ProviderBrandAsset | null): ProviderBrandAsset | null {
  if (icon?.type === 'custom') {
    return {
      key: 'custom',
      label: '自定义图标',
      monochrome: false,
      src: icon.dataUrl,
    };
  }
  if (icon?.type === 'preset') {
    const preset = providerBrandsByKey.get(icon.key);
    if (preset) return preset;
  }
  return automaticBrand;
}

export function resolveAutomaticProviderBrand(provider: ProviderBrandMatchInput): ProviderBrandAsset | null {
  // Prefer the user-facing name so a Qwen service on DashScope does not get labeled as generic Bailian.
  const namedKey = matchBrandName(provider.name) ?? matchBrandName(provider.catalogProviderId ?? '');
  if (namedKey) return providerBrandsByKey.get(namedKey) ?? null;

  try {
    const url = new URL(provider.baseUrl);
    const urlMatch = providerBrandRules.find((rule) => rule.urlKeywords?.some((keyword) => (
      keyword.startsWith(':') ? url.port === keyword.slice(1)
        : url.hostname === keyword || url.hostname.endsWith(`.${keyword}`)
    )));
    const key = urlMatch?.key ?? matchBrandName(url.hostname);
    return key ? providerBrandsByKey.get(key) ?? null : null;
  } catch {
    return null;
  }
}

export function resolveAutomaticModelBrand(model: ModelBrandInput, provider: ProviderBrandInput): ProviderBrandAsset | null {
  for (const identity of [model.code, model.name]) {
    // Inspect the model before namespace prefixes such as openrouter/cohere/command-r.
    for (const segment of identity.split('/').reverse()) {
      const normalized = normalizeBrandText(segment.normalize('NFKC'));
      const modelMatch = modelBrandRules.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)));
      const key = modelMatch?.key ?? matchBrandName(segment);
      if (key) return providerBrandsByKey.get(key) ?? null;
    }
  }
  return resolveProviderBrand(provider);
}

export function providerInitials(name: string): string {
  const normalizedName = name.trim();
  if (!normalizedName) return '?';

  const latinWords = normalizedName.match(/[a-z0-9]+/gi);
  if (latinWords?.length) {
    const initials = latinWords.length > 1
      ? latinWords.slice(0, 2).map((word) => word[0]).join('')
      : latinWords[0].slice(0, 2);
    return initials.toLocaleUpperCase();
  }

  return Array.from(normalizedName)[0] ?? '?';
}

function brandRule(
  key: string,
  label: string,
  nameKeywords: readonly string[],
  options: ProviderBrandRuleOptions = {},
): ProviderBrandRule {
  const libraryBrand = libraryProviderBrand(key);
  const src = options.src ?? libraryBrand?.src;
  if (!src) throw new Error(`Missing provider brand asset: ${key}`);
  return {
    darkSrc: options.darkSrc,
    key,
    label,
    monochrome: options.monochrome ?? libraryBrand?.monochrome ?? true,
    nameKeywords: nameKeywords.map(normalizeBrandText),
    searchText: libraryBrand?.searchText,
    src,
    urlKeywords: options.urlKeywords?.map(normalizeBrandText),
  };
}

function modelBrandRule(key: string, ...patterns: RegExp[]): ModelBrandRule {
  return { key, patterns };
}

function providerBrandAsset(rule: ProviderBrandRule): ProviderBrandAsset {
  return {
    darkSrc: rule.darkSrc,
    key: rule.key,
    label: rule.label,
    monochrome: rule.monochrome,
    searchText: rule.searchText,
    src: rule.src,
  };
}

function normalizeBrandText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
