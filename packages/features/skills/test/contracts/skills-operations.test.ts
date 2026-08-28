import { describe, expect, it } from 'vitest';
import {
  createSkill,
  readSkills,
  setSkillExtraRoots,
} from '../../src/contracts/index.js';

describe('Skills operation codecs', () => {
  it('normalizes extra roots at the transport boundary', () => {
    expect(setSkillExtraRoots.input.parse({
      extraRoots: [' /workspace/skills ', '', '/workspace/shared', '/workspace/skills'],
    })).toEqual({
      extraRoots: ['/workspace/skills', '/workspace/shared'],
    });
  });

  it('rejects malformed Skill dependencies and result snapshots', () => {
    expect(() => createSkill.input.parse({
      content: '# Search',
      mcpDependencies: [{ type: 'mcp', value: 'search', transport: 'websocket' }],
      name: 'Search',
    })).toThrow('transport');
    expect(() => readSkills.output.parse({
      skills: [{ enabled: true, id: 'search', kind: 'external', name: 'Search' }],
    })).toThrow('kind');
  });
});
