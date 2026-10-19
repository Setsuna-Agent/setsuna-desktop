import { expect, it } from 'vitest';
import { usageQueryForFilters } from '../../src/renderer/usage/usageFilters.js';

it('starts today at local midnight and rolls the other ranges back from now', () => {
  const now = new Date(2026, 7, 13, 15, 42, 35, 400);
  const span = (range: '4h' | '24h' | '7d' | '30d') => {
    const query = usageQueryForFilters({ range, provider: '', model: '' }, now);
    return Date.parse(query.to ?? '') - Date.parse(query.from ?? '');
  };

  expect(usageQueryForFilters({ range: 'today', provider: '', model: '' }, now)).toEqual({
    from: new Date(2026, 7, 13).toISOString(),
    to: now.toISOString(),
  });
  expect(span('4h')).toBe(4 * 3_600_000);
  expect(span('24h')).toBe(24 * 3_600_000);
  expect(span('7d')).toBe(7 * 24 * 3_600_000);
  expect(span('30d')).toBe(30 * 24 * 3_600_000);
  // “全部时间”不带时间边界，只透传维度条件。
  expect(usageQueryForFilters({ range: 'all', provider: 'Anthropic', model: '' }, now)).toEqual({ provider: 'Anthropic' });
});
