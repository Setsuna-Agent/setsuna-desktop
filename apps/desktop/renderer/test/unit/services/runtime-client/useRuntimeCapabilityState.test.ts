import { describe, expect, it } from 'vitest';
import {
  capabilityBootstrapValues,
  normalizeSkillExtraRoots,
} from '../../../../src/services/runtime-client/useRuntimeCapabilityState.js';

describe('capabilityBootstrapValues', () => {
  it('applies successful optional domains without manufacturing failed state', () => {
    const values = capabilityBootstrapValues({
      skillResult: fulfilled({ skills: [] }),
      mcpResult: rejected(new Error('MCP unavailable')),
      pluginResult: fulfilled({ plugins: [] }),
      pluginMarketplaceResult: fulfilled({
        plugins: [],
        errors: ['marketplace manifest is invalid'],
      }),
    });

    expect(values).toEqual({
      skills: [],
      plugins: [],
      pluginMarketplace: [],
      pluginMarketplaceErrors: ['marketplace manifest is invalid'],
    });
    expect(values).not.toHaveProperty('mcpState');
  });
});

describe('normalizeSkillExtraRoots', () => {
  it('trims, removes empty entries, and keeps first-seen order when deduplicating', () => {
    expect(normalizeSkillExtraRoots([
      ' /workspace/skills ',
      '',
      '/workspace/shared',
      '/workspace/skills',
      '   ',
    ])).toEqual([
      '/workspace/skills',
      '/workspace/shared',
    ]);
  });
});

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: 'fulfilled', value };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason };
}
