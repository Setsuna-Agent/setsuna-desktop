// @vitest-environment happy-dom

import type {
  RuntimeSkillDetail,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capabilityBootstrapValues,
  normalizeSkillExtraRoots,
  useRuntimeCapabilityState,
  type RuntimeCapabilityClient,
} from '../../../../src/services/runtime-client/useRuntimeCapabilityState.js';

afterEach(cleanup);

describe('capabilityBootstrapValues', () => {
  it('does not manufacture Skill state when the optional bootstrap fails', () => {
    const values = capabilityBootstrapValues({
      skillResult: rejected(new Error('Skills unavailable')),
    });

    expect(values).toEqual({});
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

describe('plugin Skill mutations', () => {
  it('invalidates the installed Plugin snapshot after update and delete', async () => {
    const skill = pluginSkill();
    const client = {
      deleteSkill: vi.fn(async () => undefined),
      updateSkill: vi.fn(async () => ({
        ...skill,
        content: '# Updated',
        name: 'Updated plugin Skill',
        references: [],
      } satisfies RuntimeSkillDetail)),
    } as unknown as RuntimeCapabilityClient;
    const onPluginSkillMutation = vi.fn(async () => undefined);
    const { result } = renderHook(() => useRuntimeCapabilityState({
      client,
      config: null,
      enabled: false,
      onConfigChange: vi.fn(),
      onPluginSkillMutation,
    }));

    await act(async () => {
      await result.current.updateSkill(skill, { name: 'Updated plugin Skill' });
      await result.current.deleteSkill(skill);
    });

    expect(onPluginSkillMutation).toHaveBeenCalledTimes(2);
  });
});

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason };
}

function pluginSkill(): RuntimeSkillSummary {
  return {
    enabled: true,
    id: 'plugin.sample-skill',
    kind: 'plugin',
    name: 'Sample plugin Skill',
    pluginId: 'plugin',
  };
}
