import { normalizeBrandIconConfig } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../../src/shared/i18n/I18nProvider.js';
import {
  PROVIDER_BRAND_CATALOG,
  resolveAutomaticModelBrand,
  resolveAutomaticProviderBrand,
  resolveModelBrand,
  resolveProviderBrand,
  searchProviderBrands,
} from '../../../../src/shared/branding/providerBranding.js';

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('zh-CN', key, params);
const provider = { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' };

describe('provider brand library', () => {
  it('round-trips every catalog preset through config normalization and saved icon resolution', () => {
    const keys = PROVIDER_BRAND_CATALOG.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['openrouter', 'huggingface', 'hunyuan', 'stepfun', 'claude', 'cohere']));
    for (const brand of PROVIDER_BRAND_CATALOG) {
      const saved = normalizeBrandIconConfig({ type: 'preset', key: brand.key });
      expect(saved).toEqual({ type: 'preset', key: brand.key });
      expect(resolveProviderBrand({ ...provider, icon: saved })?.key).toBe(brand.key);
    }
  });

  it('uses a saved library preset for models and retains automatic matching for unknown presets', () => {
    expect(resolveModelBrand({ name: 'Claude', code: 'claude', icon: { type: 'preset', key: 'openrouter' } }, provider)?.key).toBe('openrouter');
    expect(resolveProviderBrand({ ...provider, icon: { type: 'preset', key: 'unknown-brand' } })?.key).toBe('deepseek');
  });

  it.each([
    ['  Open ROUTER  ', 'openrouter'],
    ['腾讯混元', 'hunyuan'],
    ['阶跃星辰', 'stepfun'],
    ['Google Gemini', 'gemini'],
    ['硅基流动', 'siliconcloud'],
  ])('finds %s through brand names, localized labels and aliases', (query, key) => {
    expect(searchProviderBrands(query, t).map((brand) => brand.key)).toContain(key);
  });
});

describe('automatic brand matching', () => {
  const custom = { name: 'Custom service', baseUrl: 'https://custom.example/v1' };
  const opencode = { name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1' };

  it.each([
    { name: 'OpenCode Go', key: 'opencode' },
    { name: 'ＯｐｅｎＣｏｄｅ Go', key: 'opencode' },
    { name: 'Open Router', key: 'openrouter' },
    { name: 'HuggingFace', key: 'huggingface' },
    { name: '腾讯混元', key: 'hunyuan' },
    { name: '阶跃星辰', key: 'stepfun' },
    { name: 'LM Studio', key: 'lmstudio' },
    { name: 'Cohere', key: 'cohere' },
    { name: 'Claude Code', key: 'claudecode' },
    { name: 'Moonshot', key: 'kimi' },
  ])('matches the catalog name or alias $name', ({ name, key }) => {
    expect(resolveAutomaticProviderBrand({ ...custom, name })?.key).toBe(key);
  });

  it('uses the preset identity after the name and before a proxy hostname', () => {
    expect(resolveAutomaticProviderBrand({ ...custom, catalogProviderId: 'opencode-go' })?.key).toBe('opencode');
    expect(resolveAutomaticProviderBrand({ ...custom, catalogProviderId: 'opencode-go', name: 'Hunyuan' })?.key).toBe('hunyuan');
    expect(resolveAutomaticProviderBrand({ name: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })?.key).toBe('qwen');
  });

  it.each([
    { baseUrl: 'https://opencode.ai/zen/go/v1', key: 'opencode' },
    { baseUrl: 'https://api.openrouter.ai/api/v1', key: 'openrouter' },
    { baseUrl: 'https://api.deepseek.com/v1', key: 'deepseek' },
    { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key: 'bailian' },
    { baseUrl: 'http://127.0.0.1:11434/v1', key: 'ollama' },
  ])('falls back to the API host $baseUrl', ({ baseUrl, key }) => {
    expect(resolveAutomaticProviderBrand({ ...custom, baseUrl })?.key).toBe(key);
  });

  it('rejects embedded Latin names and ignores URL paths and query parameters', () => {
    for (const name of ['OpenCodec', 'MyOpenCode', 'Skyworker', 'Compiling']) {
      expect(resolveAutomaticProviderBrand({ ...custom, name })).toBeNull();
    }
    for (const baseUrl of ['invalid URL', 'https://custom.example/opencode?next=api.openai.com']) {
      expect(resolveAutomaticProviderBrand({ ...custom, baseUrl })).toBeNull();
    }
    // Owner annotations such as "Gemma (Google)" must not make Google match Gemma.
    expect(resolveAutomaticProviderBrand({ ...custom, name: 'Google' })?.key).toBe('google');
  });

  it.each([
    { code: 'hunyuan-t1', name: 'Default', key: 'hunyuan' },
    { code: 'stepfun/step-3', name: 'Default', key: 'stepfun' },
    { code: 'huggingface/cohere/command-r-plus', name: 'Default', key: 'cohere' },
    { code: 'openrouter/google/gemma-3', name: 'Default', key: 'gemma' },
    { code: 'anthropic/claude-sonnet-4', name: 'Default', key: 'anthropic' },
    { code: 'openai/gpt-5', name: 'Default', key: 'openai' },
    { code: 'hunyuan-t1', name: 'GPT-5', key: 'hunyuan' },
    { code: 'opaque-model-id', name: '腾讯混元', key: 'hunyuan' },
  ])('matches model $code / $name independently of its host', ({ code, name, key }) => {
    expect(resolveAutomaticModelBrand({ code, name }, opencode)?.key).toBe(key);
  });

  it('inherits the provider for unknown models and keeps explicit icons authoritative', () => {
    const model = { code: 'opaque-model-id', name: 'Default' };
    expect(resolveAutomaticModelBrand(model, opencode)?.key).toBe('opencode');
    expect(resolveModelBrand(model, { ...opencode, icon: { type: 'preset', key: 'cohere' } })?.key).toBe('cohere');
    expect(resolveProviderBrand({ ...opencode, icon: { type: 'preset', key: 'deepseek' } })?.key).toBe('deepseek');
    expect(resolveModelBrand({ ...model, icon: { type: 'preset', key: 'deepseek' } }, opencode)?.key).toBe('deepseek');
  });
});
