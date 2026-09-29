import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { groupSkillsBySource } from '../../src/renderer/skillCatalog.js';

it('groups all inherited directories independently while preserving local, plugin and builtin sources', () => {
  const roots = [
    '/Users/test/.agents/skills',
    '/Users/test/.codex/skills',
    '/Users/test/.claude/skills',
    '/Users/test/.grok/skills',
    '/Users/test/.pi/agent/skills',
    '/projects/one/skills',
    '/projects/two/skills',
  ];
  const local = skill('/app/runtime/user-skills/review/SKILL.md');
  const inherited = roots.map((root) => skill(`${root}/review/SKILL.md`));
  const plugin = { ...skill(`${roots[0]}/plugin/review/SKILL.md`), kind: 'plugin' as const };
  const builtin = { ...skill('/app/skills/review/SKILL.md'), kind: 'builtin' as const };
  const groups = groupSkillsBySource([local, ...inherited, plugin, builtin], roots, (key) => key);

  // Identical names and IDs do not determine the source or merge distinct entries.
  expect(groups.map(({ id, skills }) => ({ id, skills }))).toEqual([
    { id: 'user', skills: [local] },
    ...roots.map((root, index) => ({ id: `directory:${root}`, skills: [inherited[index]] })),
    { id: 'plugin', skills: [plugin] },
    { id: 'builtin', skills: [builtin] },
  ]);
  expect(inherited.every(({ kind }) => kind === 'user')).toBe(true);
});

it.each([
  ['C:\\Users\\Test\\.codex\\skills\\', 'c:/users/test/.CODEX/Skills/review/SKILL.md', 'c:/users/test/.codex/skills'],
  ['\\\\server\\Skills', '//SERVER/skills/review/SKILL.md', '//server/skills'],
])('matches Windows directory inheritance across separators and case: %s', (root, path, normalizedRoot) => {
  const inherited = skill(path);
  const groups = groupSkillsBySource([inherited], [root, normalizedRoot], (key) => key);
  expect(groups.map(({ id, skills }) => ({ id, skills })))
    .toEqual([{ id: `directory:${normalizedRoot}`, skills: [inherited] }]);
});

it('requires a configured root and a complete directory boundary', () => {
  const root = '/Users/test/.codex/skills';
  const others = [
    skill(`${root}-backup/review/SKILL.md`),
    skill('/Users/other/.codex/skills/review/SKILL.md'),
    skill('/Users/test/.claude/skills/review/SKILL.md'),
    skill(undefined),
  ];
  expect(groupSkillsBySource(others, [root], (key) => key).map(({ id, skills }) => ({ id, skills })))
    .toEqual([{ id: 'user', skills: others }]);
  expect(groupSkillsBySource([skill(`${root}/review/SKILL.md`)], [], (key) => key)[0].id).toBe('user');
});

it('uses the closest inherited root without duplicating skills when roots overlap', () => {
  const root = '/projects/skills';
  const nestedRoot = `${root}/team`;
  const inherited = skill(`${nestedRoot}/review/SKILL.md`);
  const groups = groupSkillsBySource([inherited], [root, nestedRoot], (key) => key);
  expect(groups.map(({ id, skills }) => ({ id, skills })))
    .toEqual([{ id: `directory:${nestedRoot}`, skills: [inherited] }]);
});

function skill(path: string | undefined): RuntimeSkillSummary {
  return { id: 'review', name: 'Review', kind: 'user', enabled: true, path };
}
