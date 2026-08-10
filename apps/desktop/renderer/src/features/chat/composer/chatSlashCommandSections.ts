import type { SlashCommandMenuItem } from './ChatSlashCommandMenu.js';

export type SlashCommandMenuSection = {
  id: 'commands' | 'skills';
  items: Array<{ index: number; item: SlashCommandMenuItem }>;
};

/** Keep the flat item index so keyboard navigation remains unchanged after visual grouping. */
export function createSlashCommandMenuSections(items: SlashCommandMenuItem[]): SlashCommandMenuSection[] {
  return items.reduce<SlashCommandMenuSection[]>((sections, item, index) => {
    const id = item.kind === 'skill' ? 'skills' : 'commands';
    const currentSection = sections.at(-1);
    if (currentSection?.id === id) {
      currentSection.items.push({ index, item });
      return sections;
    }
    sections.push({ id, items: [{ index, item }] });
    return sections;
  }, []);
}
