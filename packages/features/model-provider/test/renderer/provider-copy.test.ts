import { expect, it } from 'vitest';
import { copyProvider } from '../../src/renderer/provider-copy.js';
import { createProvider } from '../../src/renderer/provider-catalog.js';
it('duplicates editable configuration into a separate disabled identity without credentials or shared mutable data', () => {
  const source = createProvider({ providers: [] });
  source.apiKeySet = true; source.apiKeyPreview = 'sk-secret'; source.requestHeaders = { Authorization: 'Bearer secret' };
  const copy = copyProvider(source, 'Copy');
  expect(copy.id).not.toBe(source.id);
  expect(copy).toMatchObject({ enabled: false, apiKeySet: false, apiKeyPreview: '', name: 'Copy' });
  expect(copy.requestHeaders).toBeUndefined();
  expect(copy.models).toEqual(source.models);
  expect(copy.models).not.toBe(source.models);
  expect(source.apiKeySet).toBe(true);
});
