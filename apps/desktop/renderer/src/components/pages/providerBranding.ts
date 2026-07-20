import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import setsunaAppIconUrl from '../../../../../../assets/build/icon.png';
import anthropicLogoUrl from '../../assets/provider-logos/anthropic.svg';
import bailianLogoUrl from '../../assets/provider-logos/bailian.svg';
import deepseekLogoUrl from '../../assets/provider-logos/deepseek.svg';
import doubaoLogoUrl from '../../assets/provider-logos/doubao.svg';
import geminiLogoUrl from '../../assets/provider-logos/gemini.svg';
import groqLogoUrl from '../../assets/provider-logos/groq.svg';
import kimiDarkLogoUrl from '../../assets/provider-logos/kimi-dark.svg';
import kimiLogoUrl from '../../assets/provider-logos/kimi.svg';
import minimaxLogoUrl from '../../assets/provider-logos/minimax.svg';
import mistralLogoUrl from '../../assets/provider-logos/mistral.svg';
import ollamaLogoUrl from '../../assets/provider-logos/ollama.svg';
import openaiLogoUrl from '../../assets/provider-logos/openai.svg';
import qwenLogoUrl from '../../assets/provider-logos/qwen.svg';
import sakanaLogoUrl from '../../assets/provider-logos/sakana.svg';
import siliconCloudLogoUrl from '../../assets/provider-logos/siliconcloud.svg';
import volcengineLogoUrl from '../../assets/provider-logos/volcengine.svg';
import xaiLogoUrl from '../../assets/provider-logos/xai.svg';

type ProviderBrandInput = Pick<ProviderConfigState, 'baseUrl' | 'name'>;

export type ProviderBrandAsset = {
  darkSrc?: string;
  key: string;
  label: string;
  monochrome: boolean;
  src: string;
};

type ProviderBrandRule = ProviderBrandAsset & {
  nameKeywords: readonly string[];
  urlKeywords?: readonly string[];
};

type ProviderBrandRuleOptions = {
  darkSrc?: string;
  monochrome?: boolean;
  urlKeywords?: readonly string[];
};

const providerBrandRules: readonly ProviderBrandRule[] = [
  brandRule('setsuna', 'Setsuna', setsunaAppIconUrl, ['setsuna'], { monochrome: false }),
  brandRule('minimax', 'MiniMax', minimaxLogoUrl, ['minimax', '海螺'], {
    monochrome: false,
    urlKeywords: ['minimaxi.com', 'minimax.io', 'minimax.chat'],
  }),
  brandRule('kimi', 'Kimi', kimiLogoUrl, ['kimi', 'moonshot', '月之暗面'], {
    darkSrc: kimiDarkLogoUrl,
    monochrome: false,
    urlKeywords: ['moonshot.cn', 'moonshot.ai', 'kimi.com'],
  }),
  brandRule('deepseek', 'DeepSeek', deepseekLogoUrl, ['deepseek', '深度求索'], {
    monochrome: false,
    urlKeywords: ['deepseek.com'],
  }),
  brandRule('sakana', 'Sakana AI', sakanaLogoUrl, ['sakana'], { monochrome: false, urlKeywords: ['sakana.ai'] }),
  brandRule('qwen', 'Qwen', qwenLogoUrl, ['qwen', '通义千问', '千问'], { monochrome: false, urlKeywords: ['qwen'] }),
  brandRule('doubao', '豆包', doubaoLogoUrl, ['doubao', '豆包'], { monochrome: false, urlKeywords: ['doubao'] }),
  brandRule('bailian', '阿里云百炼', bailianLogoUrl, ['bailian', '百炼', '阿里云', 'alibaba cloud', 'aliyun'], {
    monochrome: false,
    urlKeywords: ['dashscope.aliyuncs.com'],
  }),
  brandRule('volcengine', '火山引擎', volcengineLogoUrl, ['volcengine', '火山引擎', '火山方舟'], {
    monochrome: false,
    urlKeywords: ['volces.com', 'volcengine.com'],
  }),
  brandRule('siliconcloud', '硅基流动', siliconCloudLogoUrl, ['siliconcloud', 'siliconflow', '硅基流动'], {
    monochrome: false,
    urlKeywords: ['siliconflow.cn'],
  }),
  brandRule('openai', 'OpenAI', openaiLogoUrl, ['openai', 'chatgpt'], { urlKeywords: ['api.openai.com'] }),
  brandRule('anthropic', 'Anthropic', anthropicLogoUrl, ['anthropic', 'claude'], { urlKeywords: ['anthropic.com'] }),
  brandRule('gemini', 'Google Gemini', geminiLogoUrl, ['gemini', 'google ai', 'google vertex'], {
    monochrome: false,
    urlKeywords: ['generativelanguage.googleapis.com', 'aiplatform.googleapis.com'],
  }),
  brandRule('ollama', 'Ollama', ollamaLogoUrl, ['ollama'], { urlKeywords: [':11434'] }),
  brandRule('mistral', 'Mistral AI', mistralLogoUrl, ['mistral'], { monochrome: false, urlKeywords: ['mistral.ai'] }),
  brandRule('groq', 'Groq', groqLogoUrl, ['groq'], { urlKeywords: ['groq.com'] }),
  brandRule('xai', 'xAI', xaiLogoUrl, ['xai', 'x.ai', 'grok'], { urlKeywords: ['api.x.ai'] }),
];

export function resolveProviderBrand(provider: ProviderBrandInput): ProviderBrandAsset | null {
  const normalizedName = normalizeBrandText(provider.name);
  const normalizedUrl = normalizeBrandText(provider.baseUrl);

  // Prefer the user-facing name so a Qwen service on DashScope does not get labeled as generic Bailian.
  const nameMatch = providerBrandRules.find((rule) => rule.nameKeywords.some((keyword) => normalizedName.includes(keyword)));
  if (nameMatch) return providerBrandAsset(nameMatch);

  const urlMatch = providerBrandRules.find((rule) => rule.urlKeywords?.some((keyword) => normalizedUrl.includes(keyword)));
  return urlMatch ? providerBrandAsset(urlMatch) : null;
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
  src: string,
  nameKeywords: readonly string[],
  options: ProviderBrandRuleOptions = {},
): ProviderBrandRule {
  return {
    darkSrc: options.darkSrc,
    key,
    label,
    monochrome: options.monochrome ?? true,
    nameKeywords: nameKeywords.map(normalizeBrandText),
    src,
    urlKeywords: options.urlKeywords?.map(normalizeBrandText),
  };
}

function providerBrandAsset(rule: ProviderBrandRule): ProviderBrandAsset {
  return {
    darkSrc: rule.darkSrc,
    key: rule.key,
    label: rule.label,
    monochrome: rule.monochrome,
    src: rule.src,
  };
}

function normalizeBrandText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
