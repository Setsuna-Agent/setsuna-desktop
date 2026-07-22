import { describe, expect, it } from 'vitest';
import {
  createMarkdownRenderBlocks,
  parseMarkdownBlocks,
} from '../../../../../src/features/chat/markdown/streamingMarkdown.js';

describe('streamingMarkdown', () => {
  it('keeps completed blocks stable and marks only the streaming tail mutable', () => {
    const blocks = createMarkdownRenderBlocks('Stable paragraph.\n\nCurrent **bold', true);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ content: 'Stable paragraph.', mutable: false });
    expect(blocks[1]).toEqual({ content: 'Current **bold**', mutable: true });
  });

  it('does not mutate finalized markdown', () => {
    const blocks = createMarkdownRenderBlocks('Current **bold', false);

    expect(blocks).toEqual([{ content: 'Current **bold', mutable: false }]);
  });

  it('keeps document-scoped references in the same markdown tree', () => {
    const markdown = 'Read [the docs][docs].\n\n[docs]: https://example.com/docs';

    expect(parseMarkdownBlocks(markdown)).toEqual([markdown]);
  });

  it('uses parser boundaries for lists, tables, and fenced code', () => {
    const markdown = '- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst ok = true;\n```';
    const blocks = parseMarkdownBlocks(markdown);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('- one');
    expect(blocks[1]).toContain('| A | B |');
    expect(blocks[2]).toContain('```ts');
  });
});
