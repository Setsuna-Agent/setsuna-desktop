import {
  DEFAULT_NPM_REGISTRY_URL,
  normalizeNpmRegistryUrl,
} from '../../src/contracts/index.js';
import { describe, expect, it } from 'vitest';
import { planPackageSourceSave } from '../../src/renderer/package-source-save.js';

describe('planPackageSourceSave', () => {
  it('does not persist when Enter is pressed without changing the source', () => {
    expect(planPackageSourceSave({
      defaultValue: DEFAULT_NPM_REGISTRY_URL,
      draft: DEFAULT_NPM_REGISTRY_URL,
      effectiveValue: DEFAULT_NPM_REGISTRY_URL,
      normalize: normalizeNpmRegistryUrl,
    })).toEqual({
      kind: 'unchanged',
      displayValue: DEFAULT_NPM_REGISTRY_URL,
    });
  });

  it('normalizes and persists a custom source', () => {
    expect(planPackageSourceSave({
      defaultValue: DEFAULT_NPM_REGISTRY_URL,
      draft: '  https://registry.example.com/npm/  ',
      effectiveValue: DEFAULT_NPM_REGISTRY_URL,
      normalize: normalizeNpmRegistryUrl,
    })).toEqual({
      kind: 'persist',
      displayValue: 'https://registry.example.com/npm/',
      persistedValue: 'https://registry.example.com/npm/',
    });
  });

  it('restores the default source when a custom value is cleared', () => {
    expect(planPackageSourceSave({
      defaultValue: DEFAULT_NPM_REGISTRY_URL,
      draft: '',
      effectiveValue: 'https://registry.example.com/npm/',
      normalize: normalizeNpmRegistryUrl,
    })).toEqual({
      kind: 'persist',
      displayValue: DEFAULT_NPM_REGISTRY_URL,
      persistedValue: DEFAULT_NPM_REGISTRY_URL,
    });
  });

  it('rejects unsupported source protocols', () => {
    expect(planPackageSourceSave({
      defaultValue: DEFAULT_NPM_REGISTRY_URL,
      draft: 'file:///tmp/npm',
      effectiveValue: DEFAULT_NPM_REGISTRY_URL,
      normalize: normalizeNpmRegistryUrl,
    })).toEqual({ kind: 'invalid' });
  });
});
