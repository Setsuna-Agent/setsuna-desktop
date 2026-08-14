import { describe, expect, it } from 'vitest';
import type { SlashCommandMenuItem } from '../../../../../src/features/chat/composer/ChatSlashCommandMenu.js';
import { createSlashCommandMenuSections } from '../../../../../src/features/chat/composer/chatSlashCommandSections.js';

describe('createSlashCommandMenuSections', () => {
  it('separates commands and skills while preserving flat navigation indexes', () => {
    const sections = createSlashCommandMenuSections([
      modelItem(),
      actionItem(),
      pluginSkillItem(),
    ]);

    expect(sections.map((section) => section.id)).toEqual(['commands', 'skills']);
    expect(sections[0].items.map(({ index, item }) => [index, item.key])).toEqual([
      [0, 'model'],
      [1, 'review'],
    ]);
    expect(sections[1].items.map(({ index, item }) => [index, item.key])).toEqual([
      [2, 'skill:pdf'],
    ]);
  });

  it('only creates sections represented by the filtered items', () => {
    expect(createSlashCommandMenuSections([pluginSkillItem()]).map((section) => section.id)).toEqual(['skills']);
    expect(createSlashCommandMenuSections([])).toEqual([]);
  });
});

function modelItem(): SlashCommandMenuItem {
  return {
    key: 'model',
    kind: 'model',
    title: 'Model',
  };
}

function actionItem(): SlashCommandMenuItem {
  return {
    key: 'review',
    kind: 'action',
    type: 'review',
    title: 'Review changes',
  };
}

function pluginSkillItem(): SlashCommandMenuItem {
  return {
    key: 'skill:pdf',
    kind: 'skill',
    skill: {
      id: 'pdf',
      name: 'PDF',
      description: 'Read and verify PDF files',
      kind: 'plugin',
      enabled: true,
    },
  };
}
