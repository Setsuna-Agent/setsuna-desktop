import { describe, expect, it } from 'vitest';
import { providerInitials, resolveProviderBrand } from './providerBranding.js';

describe('resolveProviderBrand', () => {
  it.each([
    ['MiniMax', 'https://api.minimaxi.com/v1', 'minimax'],
    ['火山方舟', 'https://ark.cn-beijing.volces.com/api/v3', 'volcengine'],
    ['bailian', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'bailian'],
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
