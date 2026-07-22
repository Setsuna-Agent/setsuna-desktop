import { describe, expect, it } from 'vitest';
import {
  PROVIDER_BRAND_CATALOG,
  providerInitials,
  resolveAutomaticModelBrand,
  resolveModelBrand,
  resolveProviderBrand,
} from '../../../../src/shared/branding/providerBranding.js';

describe('resolveProviderBrand', () => {
  it.each([
    ['MiniMax', 'https://api.minimaxi.com/v1', 'minimax'],
    ['火山方舟', 'https://ark.cn-beijing.volces.com/api/v3', 'volcengine'],
    ['bailian', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'bailian'],
    ['智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4', 'glm'],
    ['Kimi', 'https://api.moonshot.cn/v1', 'kimi'],
    ['sakana', 'https://api.sakana.ai/v1', 'sakana'],
    ['Local Ollama', 'http://127.0.0.1:11434/v1', 'ollama'],
  ])('matches %s', (name, baseUrl, expectedKey) => {
    expect(resolveProviderBrand({ name, baseUrl })?.key).toBe(expectedKey);
  });

  it('prefers a specific provider name over a shared gateway URL', () => {
    expect(resolveProviderBrand({ name: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })?.key).toBe('qwen');
  });

  it('uses color assets and a dark-theme Kimi variant where available', () => {
    expect(resolveProviderBrand({ name: 'MiniMax', baseUrl: '' })?.monochrome).toBe(false);
    expect(resolveProviderBrand({ name: 'Kimi', baseUrl: '' })?.darkSrc).toBeTruthy();
    expect(resolveProviderBrand({ name: 'OpenAI', baseUrl: '' })?.monochrome).toBe(true);
  });

  it('lets an explicit preset or custom image override automatic matching', () => {
    expect(resolveProviderBrand({
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/v1',
      icon: { type: 'preset', key: 'qwen' },
    })?.key).toBe('qwen');
    expect(resolveProviderBrand({
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/v1',
      icon: { type: 'custom', dataUrl: 'data:image/png;base64,aWNvbg==' },
    })).toMatchObject({ key: 'custom', src: 'data:image/png;base64,aWNvbg==' });
  });

  it('publishes every built-in brand as a selectable preset', () => {
    expect(PROVIDER_BRAND_CATALOG.map((brand) => brand.key)).toEqual(expect.arrayContaining([
      'setsuna',
      'minimax',
      'kimi',
      'deepseek',
      'glm',
      'qwen',
      'bailian',
      'volcengine',
      'openai',
      'anthropic',
      'gemini',
      'ollama',
    ]));
  });

  it('returns null for a custom service', () => {
    expect(resolveProviderBrand({ name: 'Servyou', baseUrl: 'https://models.example.com/v1' })).toBeNull();
  });
});

describe('providerInitials', () => {
  it('creates compact Latin initials and preserves a Chinese leading character', () => {
    expect(providerInitials('Servyou')).toBe('SE');
    expect(providerInitials('Local Provider')).toBe('LP');
    expect(providerInitials('自定义服务')).toBe('自');
  });
});

describe('model brand matching', () => {
  it.each([
    ['gpt-5.6-luna', 'openai'],
    ['claude-sonnet-4', 'anthropic'],
    ['gemini-2.5-pro', 'gemini'],
    ['deepseek-r1', 'deepseek'],
    ['glm-5-2', 'glm'],
    ['qwen3-coder', 'qwen'],
    ['MiniMax-M3', 'minimax'],
    ['moonshot-v1-128k', 'kimi'],
    ['mixtral-8x7b', 'mistral'],
    ['doubao-seed-1.6', 'doubao'],
    ['grok-4', 'xai'],
  ])('matches %s to %s', (code, expectedKey) => {
    expect(resolveAutomaticModelBrand(
      { code, name: code },
      { name: 'Local', baseUrl: 'http://127.0.0.1:8000/v1' },
    )?.key).toBe(expectedKey);
  });

  it('falls back to the configured provider icon and allows a model override', () => {
    const provider = {
      name: 'Local',
      baseUrl: 'http://127.0.0.1:8000/v1',
      icon: { type: 'preset', key: 'ollama' } as const,
    };
    expect(resolveAutomaticModelBrand({ code: 'llama-3.3', name: 'Llama 3.3' }, provider)?.key).toBe('ollama');
    expect(resolveModelBrand({
      code: 'llama-3.3',
      name: 'Llama 3.3',
      icon: { type: 'preset', key: 'qwen' },
    }, provider)?.key).toBe('qwen');
  });
});
