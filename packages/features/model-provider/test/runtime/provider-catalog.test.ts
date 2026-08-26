import { describe, expect, it } from 'vitest';
import { createModelProviderCatalog } from '../../src/runtime/provider-catalog.js';

describe('Pi model provider catalog', () => {
  it('projects supported built-in providers into key-only connection plans', () => {
    const catalog = createModelProviderCatalog();
    const openai = catalog.providers.find((provider) => provider.id === 'openai');
    const anthropic = catalog.providers.find((provider) => provider.id === 'anthropic');
    const deepseek = catalog.providers.find((provider) => provider.id === 'deepseek');

    expect(openai?.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai-responses', baseUrl: 'https://api.openai.com/v1' }),
    ]));
    expect(anthropic?.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }),
    ]));
    expect(deepseek?.plans[0]).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(deepseek?.plans[0]?.models[0]).toEqual(expect.objectContaining({
      code: expect.any(String),
      contextWindowTokens: expect.any(Number),
      maxOutputTokens: expect.any(Number),
      thinkingEfforts: expect.any(Array),
    }));
  });

  it('exposes only the three protocols supported by this Feature and usable concrete URLs', () => {
    const plans = createModelProviderCatalog().providers.flatMap((provider) => provider.plans);
    expect(new Set(plans.map((plan) => plan.provider))).toEqual(new Set([
      'openai-compatible',
      'openai-responses',
      'anthropic',
    ]));
    expect(plans.every((plan) => /^https?:\/\//u.test(plan.baseUrl) && !/[{}]/u.test(plan.baseUrl))).toBe(true);
  });
});
