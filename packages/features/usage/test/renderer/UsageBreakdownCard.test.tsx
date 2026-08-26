import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UsageBreakdownCard } from '../../src/renderer/usage/UsageBreakdownCard.js';
import { usageView } from './support.js';

describe('UsageBreakdownCard', () => {
  it('forwards the dominant provider when resolving a shared model brand', () => {
    const BrandIcon = vi.fn(() => null);
    renderToStaticMarkup(
      usageView(<UsageBreakdownCard
        buckets={[{
          key: 'shared-model',
          inputTokens: 900,
          cachedInputTokens: 0,
          outputTokens: 100,
          totalTokens: 1_000,
          recordCount: 2,
          dominantProviderId: 'sakana',
          dominantProvider: 'Sakana',
        }]}
        providers={[]}
        totalTokens={1_000}
        variant="model"
      />, BrandIcon),
    );

    expect(BrandIcon.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      kind: 'model',
      name: 'shared-model',
      providerId: 'sakana',
      providerName: 'Sakana',
      providers: [],
    }));
  });
});
