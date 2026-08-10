import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { parseSkillReferenceText } from '../../../../../src/features/chat/skills/skillReferenceParser.js';

const skills: RuntimeSkillSummary[] = [
  {
    id: 'pdf',
    name: 'PDF',
    kind: 'builtin',
    enabled: true,
    selected: false,
  },
  {
    id: 'pdf-documents',
    name: 'PDF 文档处理',
    kind: 'builtin',
    enabled: true,
    selected: false,
  },
  {
    id: 'review-builtin',
    name: 'Review',
    kind: 'builtin',
    enabled: true,
    selected: false,
  },
  {
    id: 'review-user',
    name: 'Review',
    kind: 'user',
    enabled: true,
    selected: false,
  },
];

describe('parseSkillReferenceText', () => {
  it('renders the exact persisted ranges for selected Skills', () => {
    const content = 'PDF 文档处理 然后使用 PDF';
    const secondStart = content.lastIndexOf('PDF');
    const parts = parseSkillReferenceText(
      content,
      [
        { skillId: 'pdf-documents', start: 0, end: 'PDF 文档处理'.length },
        { skillId: 'pdf', start: secondStart, end: secondStart + 'PDF'.length },
      ],
      skills,
    );

    expect(parts.map((part) => part.type === 'skill' ? part.skillId : part.value)).toEqual([
      'pdf-documents',
      ' 然后使用 ',
      'pdf',
    ]);
  });

  it('leaves an earlier ordinary occurrence plain when the selected slot comes later', () => {
    const content = '不要使用 PDF；改用 PDF';
    const selectedStart = content.lastIndexOf('PDF');

    expect(parseSkillReferenceText(content, [{
      skillId: 'pdf',
      start: selectedStart,
      end: selectedStart + 'PDF'.length,
    }], skills).map((part) => part.type === 'skill' ? part.skillId : part.value)).toEqual([
      '不要使用 PDF；改用 ',
      'pdf',
    ]);
  });

  it('preserves different Skill IDs that share the same display name', () => {
    const content = 'Review 然后 Review';
    const secondStart = content.lastIndexOf('Review');

    expect(parseSkillReferenceText(content, [
      { skillId: 'review-builtin', start: 0, end: 'Review'.length },
      { skillId: 'review-user', start: secondStart, end: secondStart + 'Review'.length },
    ], skills).filter((part) => part.type === 'skill').map((part) => part.skillId)).toEqual([
      'review-builtin',
      'review-user',
    ]);
  });

  it('uses the persisted slot range even when the Skill touches surrounding prose', () => {
    const content = '请用Review检查';

    expect(parseSkillReferenceText(
      content,
      [{ skillId: 'review-builtin', start: 2, end: 8 }],
      skills,
    ).map((part) => part.type === 'skill' ? part.skillId : part.value)).toEqual([
      '请用',
      'review-builtin',
      '检查',
    ]);
  });

  it('keeps the historical serialized label after a Skill is renamed', () => {
    const renamedSkills = skills.map((skill) => (
      skill.id === 'review-user' ? { ...skill, name: 'Review Plus' } : skill
    ));

    expect(parseSkillReferenceText(
      'Review',
      [{ skillId: 'review-user', start: 0, end: 'Review'.length }],
      renamedSkills,
    )).toEqual([{
      skill: expect.objectContaining({ id: 'review-user', name: 'Review Plus' }),
      skillId: 'review-user',
      start: 0,
      type: 'skill',
      value: 'Review',
    }]);
  });

  it('keeps a durable fallback reference after the Skill leaves the catalog', () => {
    expect(parseSkillReferenceText(
      'Review',
      [{ skillId: 'review-user', start: 0, end: 'Review'.length }],
      [],
    )).toEqual([{
      skillId: 'review-user',
      start: 0,
      type: 'skill',
      value: 'Review',
    }]);
  });

  it('requires valid durable range metadata', () => {
    expect(parseSkillReferenceText('PDF 是普通文字', undefined, skills)).toEqual([
      { start: 0, type: 'text', value: 'PDF 是普通文字' },
    ]);
    expect(parseSkillReferenceText('myPDFparser', [{ skillId: 'pdf', start: -1, end: 2 }], skills)).toEqual([
      { start: 0, type: 'text', value: 'myPDFparser' },
    ]);
  });
});
