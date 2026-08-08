import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UsageBreakdownCard } from '../../../../../src/features/settings/usage/UsageBreakdownCard.js';

const { usageModelBrand } = vi.hoisted(() => ({
  usageModelBrand: vi.fn(() => null),
}));

vi.mock('../../../../../src/features/settings/usage/usageBranding.js', async (importOriginal) => ({
  ...await importOriginal(),
  usageModelBrand,
}));

describe('UsageBreakdownCard', () => {
  it('forwards the dominant provider when resolving a shared model brand', () => {
    renderToStaticMarkup(
      <UsageBreakdownCard
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
      />,
    );

    expect(usageModelBrand).toHaveBeenCalledWith([], 'shared-model', 'sakana', 'Sakana');
  });
});
