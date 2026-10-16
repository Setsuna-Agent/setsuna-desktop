import type { ComposerSlot } from '../../../../../src/features/chat/composer/editor/types.js';
import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createSelectedSkillReferences,
  createSelectedSkillSlot,
  createReferenceDraftSlots,
  createTextSlot,
  createWorkspaceMentionInsertion,
  createWorkspaceDraftReferences,
  createWorkspaceMentionSlots,
  filterSelectedSkillsBySlots,
  getChatComposerSlotReference,
} from '../../../../../src/features/chat/composer/chatComposerSlots.js';

const entry: WorkspaceEntrySearchItem = {
  kind: 'file',
  name: 'vite.config.ts',
  parent: '',
  path: 'vite.config.ts',
};

describe('workspace mention slots', () => {
  it.each([
    { path: 'src/domain/agent-pc', name: 'agent-pc', kind: 'directory' as const },
    { path: '/worktree/设计 文档/spec.md', name: 'spec.md', kind: 'file' as const },
    { path: 'C:\\worktree\\设计 文档\\spec.md', name: 'spec.md', kind: 'file' as const },
    { path: '\\\\server\\project\\src', name: 'src', kind: 'directory' as const },
  ])('restores the $kind reference $path without changing its serialized path or adjacent text', (reference) => {
    const slots = createWorkspaceMentionSlots({ ...reference, parent: '' });
    const serialize = (items: ComposerSlot[]) => items.map((slot) => slot.type === 'text' ? slot.value : slot.props.value).join('');
    const completeSlots = [createTextSlot('请检查 '), ...slots, createTextSlot('1231313213\n')];
    const draft = serialize(completeSlots);
    const recovered = createReferenceDraftSlots(draft, [], [], [], createWorkspaceDraftReferences(completeSlots));
    expect(serialize(recovered)).toBe(draft);
    expect(recovered.map(getChatComposerSlotReference).filter(Boolean)).toEqual([
      { type: 'workspace', entry: expect.objectContaining(reference) },
    ]);
    expect(createWorkspaceMentionInsertion({ ...reference, parent: '' }, draft, recovered)).toBeNull();
  });

  it('creates a highlighted tag slot that submits the full workspace mention', () => {
    const slots = createWorkspaceMentionSlots(entry);
    const mention = slots[0];

    expect(mention?.type).toBe('tag');
    if (!mention || mention.type !== 'tag') throw new Error('Expected a workspace mention tag');
    expect(mention.key).toMatch(/^workspace:/);
    expect(mention.props?.value).toBe('@vite.config.ts');
    expect(slots[1]).toEqual({ type: 'text', value: ' ' });
  });

  it('appends after existing content without replacing trailing whitespace', () => {
    const insertion = createWorkspaceMentionInsertion(entry, '请检查这个文件   ', []);

    expect(insertion?.replaceCharacters).toBeUndefined();
    expect(insertion?.slots[0]?.type).toBe('tag');
  });

  it('adds a separator when appending after non-whitespace content', () => {
    const insertion = createWorkspaceMentionInsertion(entry, '请检查这个文件', []);

    expect(insertion?.slots[0]).toEqual({ type: 'text', value: ' ' });
    expect(insertion?.slots[1]?.type).toBe('tag');
  });

  it('does not add the same workspace mention slot twice', () => {
    const existingSlots = createWorkspaceMentionSlots(entry);

    expect(createWorkspaceMentionInsertion(entry, '@vite.config.ts ', existingSlots)).toBeNull();
  });

  it('supports nested paths while displaying the file name', () => {
    const nestedEntry = { ...entry, name: 'Tile.tsx', parent: 'src/components', path: 'src/components/Tile.tsx' };
    const mention = createWorkspaceMentionSlots(nestedEntry).find(
      (slot): slot is Extract<ComposerSlot, { type: 'tag' }> => slot.type === 'tag',
    );

    expect(mention?.props?.value).toBe('@src/components/Tile.tsx');
    const labelHtml = renderToStaticMarkup(mention?.props?.label);
    expect(labelHtml).toContain('>Tile.tsx</span>');
    expect(labelHtml).not.toContain('@Tile.tsx');
  });

  it('keeps the directory marker in the submitted value but omits it from the label', () => {
    const directoryEntry: WorkspaceEntrySearchItem = {
      kind: 'directory',
      name: '.trae',
      parent: '',
      path: '.trae',
    };
    const mention = createWorkspaceMentionSlots(directoryEntry).find(
      (slot): slot is Extract<ComposerSlot, { type: 'tag' }> => slot.type === 'tag',
    );

    if (!mention) throw new Error('Expected a workspace mention tag');
    expect(mention.props?.value).toBe('@.trae/');
    const labelHtml = renderToStaticMarkup(mention.props?.label);
    expect(labelHtml).toContain('>.trae</span>');
    expect(labelHtml).not.toContain('>.trae/</span>');
  });

  it('creates skill slots and retains selections represented by the slot config', () => {
    const firstSkill = {
      id: 'first',
      name: 'First skill',
      kind: 'user' as const,
      enabled: true,
      description: 'First description',
    };
    const secondSkill = {
      ...firstSkill,
      id: 'second',
      name: 'Second skill',
    };
    const slot = createSelectedSkillSlot(firstSkill);

    if (slot.type !== 'tag') throw new Error('Expected a selected Skill tag');
    expect(slot.key).toMatch(/^skill:/);
    expect(slot.composerReference).toEqual({ type: 'skill', skillId: firstSkill.id });
    expect(slot.props?.value).toBe('First skill');
    const labelHtml = renderToStaticMarkup(slot.props?.label);
    expect(labelHtml).toContain('First skill');
    expect(filterSelectedSkillsBySlots([firstSkill, secondSkill], [slot])).toEqual([firstSkill]);
    const unchangedSkills = [firstSkill];
    expect(filterSelectedSkillsBySlots(unchangedSkills, [slot])).toBe(unchangedSkills);
    expect(filterSelectedSkillsBySlots([firstSkill], undefined)).toEqual([]);
  });

  it('records exact trimmed offsets for Skills with identical labels', () => {
    const firstSkill = {
      id: 'review-builtin',
      name: 'Review',
      kind: 'builtin' as const,
      enabled: true,
    };
    const secondSkill = { ...firstSkill, id: 'review-user', kind: 'user' as const };
    const trimmedContent = 'Use Review then Review';
    const secondStart = trimmedContent.lastIndexOf('Review');

    expect(createSelectedSkillReferences([
      createTextSlot('  Use '),
      createSelectedSkillSlot(firstSkill),
      createTextSlot(' then '),
      createSelectedSkillSlot(secondSkill),
      createTextSlot('  '),
    ])).toEqual([
      { skillId: firstSkill.id, start: 'Use '.length, end: 'Use Review'.length },
      { skillId: secondSkill.id, start: secondStart, end: secondStart + 'Review'.length },
    ]);
  });
});
