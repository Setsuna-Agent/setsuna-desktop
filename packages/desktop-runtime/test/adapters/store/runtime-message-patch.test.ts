import { describe, expect, it } from 'vitest';
import { normalizeRuntimeMessagePatch } from '../../../src/adapters/store/runtime-message-patch.js';

describe('normalizeRuntimeMessagePatch', () => {
  it('preserves selected Skill IDs but clears stale ranges when content changes', () => {
    expect(normalizeRuntimeMessagePatch({
      content: 'Review original',
      skillIds: ['skill_review'],
      skillReferences: [{ skillId: 'skill_review', start: 0, end: 6 }],
    }, {
      content: 'prefix Review original',
    })).toEqual({
      content: 'prefix Review original',
      skillIds: ['skill_review'],
      skillReferences: [],
    });
  });

  it('persists valid explicit replacement metadata', () => {
    expect(normalizeRuntimeMessagePatch({
      content: 'Old Skill prompt',
      skillIds: ['skill_old'],
      skillReferences: [{ skillId: 'skill_old', start: 0, end: 9 }],
    }, {
      content: 'New Skill prompt',
      skillIds: ['skill_new'],
      skillReferences: [{ skillId: 'skill_new', start: 0, end: 9 }],
    })).toEqual({
      content: 'New Skill prompt',
      skillIds: ['skill_new'],
      skillReferences: [{ skillId: 'skill_new', start: 0, end: 9 }],
    });
  });
});
