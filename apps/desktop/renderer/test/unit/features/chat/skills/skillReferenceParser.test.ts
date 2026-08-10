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
];

describe('parseSkillReferenceText', () => {
  it('matches selected references once and prefers the longest label at the same position', () => {
    const parts = parseSkillReferenceText(
      'PDF 文档处理 然后使用 PDF',
      ['pdf', 'pdf-documents'],
      skills,
    );

    expect(parts.map((part) => part.type === 'skill' ? part.skill.id : part.value)).toEqual([
      'pdf-documents',
      ' 然后使用 ',
      'pdf',
    ]);
  });

  it('requires both durable selection metadata and a standalone serialized label', () => {
    expect(parseSkillReferenceText('PDF 是普通文字', undefined, skills)).toEqual([
      { start: 0, type: 'text', value: 'PDF 是普通文字' },
    ]);
    expect(parseSkillReferenceText('myPDFparser', ['pdf'], skills)).toEqual([
      { start: 0, type: 'text', value: 'myPDFparser' },
    ]);
  });
});
