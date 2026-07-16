import { describe, expect, it } from 'vitest';
import type { SlotConfigType } from '@ant-design/x/es/sender';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { createWorkspaceMentionInsertion, createWorkspaceMentionSlots } from './chatComposerSlots.js';

const entry: WorkspaceEntrySearchItem = {
  kind: 'file',
  name: 'vite.config.ts',
  parent: '',
  path: 'vite.config.ts',
};

describe('workspace mention slots', () => {
  it('creates a highlighted tag slot that submits the full workspace mention', () => {
    const slots = createWorkspaceMentionSlots(entry);
    const mention = slots[0];

    expect(mention?.type).toBe('tag');
    if (!mention || mention.type !== 'tag') throw new Error('Expected a workspace mention tag');
    expect(mention.key).toMatch(/^workspace:/);
    expect(mention.props?.value).toBe('@vite.config.ts');
    expect(mention.formatResult?.(mention.props?.value)).toBe('@vite.config.ts');
    expect(slots[1]).toEqual({ type: 'text', value: ' ' });
  });

  it('appends after existing content while replacing trailing whitespace', () => {
    const insertion = createWorkspaceMentionInsertion(entry, '请检查这个文件   ', []);

    expect(insertion?.replaceCharacters).toBe('   ');
    expect(insertion?.slots[0]).toEqual({ type: 'text', value: '\n' });
    expect(insertion?.slots[1]?.type).toBe('tag');
  });

  it('does not add the same workspace mention slot twice', () => {
    const existingSlots = createWorkspaceMentionSlots(entry);

    expect(createWorkspaceMentionInsertion(entry, '@vite.config.ts ', existingSlots)).toBeNull();
  });

  it('supports nested paths while displaying the file name', () => {
    const nestedEntry = { ...entry, name: 'Tile.tsx', parent: 'src/components', path: 'src/components/Tile.tsx' };
    const mention = createWorkspaceMentionSlots(nestedEntry).find(
      (slot): slot is Extract<SlotConfigType, { type: 'tag' }> => slot.type === 'tag',
    );

    expect(mention?.props?.value).toBe('@src/components/Tile.tsx');
    const labelHtml = renderToStaticMarkup(mention?.props?.label);
    expect(labelHtml).toContain('data-file-icon-theme="seti"');
    expect(labelHtml).toContain('data-composer-cursor-offset-adjustment=');
    expect(labelHtml).toContain('>Tile.tsx</span>');
    expect(labelHtml).not.toContain('@Tile.tsx');
  });
});
