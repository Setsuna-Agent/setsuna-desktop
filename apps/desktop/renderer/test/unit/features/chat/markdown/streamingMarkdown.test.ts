import { describe, expect, it } from 'vitest';
import {
  createMarkdownRenderBlocks,
  parseMarkdownBlocks,
  reconcileMarkdownRenderBlocks,
  type StreamingMarkdownRenderState,
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

  it('commits a table only after a following block proves its boundary', () => {
    let state: StreamingMarkdownRenderState | null = null;
    const update = (markdown: string) => {
      const result = reconcileMarkdownRenderBlocks(state, markdown, true);
      state = result.state;
      return result;
    };

    expect(update('Intro.\n\n| A | B |').blocks).toEqual([
      { content: 'Intro.', mutable: false },
      { content: '| A | B |', mutable: true },
    ]);

    const table = update('Intro.\n\n| A | B |\n| - | - |\n| 1 | 2 |').blocks;
    expect(table[1]?.mutable).toBe(true);
    expect(table[1]?.content).toContain('| 1 | 2 |');

    const completedTable = update('Intro.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nAfter.');
    expect(completedTable.blocks).toHaveLength(3);
    expect(completedTable.blocks[1]?.mutable).toBe(false);
    expect(completedTable.blocks[2]).toEqual({ content: 'After.', mutable: true });
    expect(completedTable.state?.tailSource).toBe('After.');
  });

  it('keeps an open or trailing fenced block in the mutable tail', () => {
    const open = reconcileMarkdownRenderBlocks(
      null,
      'Intro.\n\n```ts\nconst answer = 42;',
      true,
    );
    expect(open.blocks[0]).toEqual({ content: 'Intro.', mutable: false });
    expect(open.blocks[1]?.mutable).toBe(true);
    expect(open.state?.tailSource).toContain('```ts');

    const closed = reconcileMarkdownRenderBlocks(
      open.state,
      'Intro.\n\n```ts\nconst answer = 42;\n```',
      true,
    );
    expect(closed.blocks[1]?.mutable).toBe(true);

    const followed = reconcileMarkdownRenderBlocks(
      closed.state,
      'Intro.\n\n```ts\nconst answer = 42;\n```\n\nAfter.',
      true,
    );
    expect(followed.blocks[1]?.mutable).toBe(false);
    expect(followed.blocks[2]).toEqual({ content: 'After.', mutable: true });
  });

  it('keeps an unmatched display-math region together across blank lines', () => {
    const open = reconcileMarkdownRenderBlocks(
      null,
      'Intro.\n\n$$\n\\begin{aligned}\nx &= 1',
      true,
    );
    const continued = reconcileMarkdownRenderBlocks(
      open.state,
      'Intro.\n\n$$\n\\begin{aligned}\nx &= 1\n\n&= 2',
      true,
    );

    expect(continued.blocks).toHaveLength(2);
    expect(continued.blocks[0]).toEqual({ content: 'Intro.', mutable: false });
    expect(continued.blocks[1]?.mutable).toBe(true);
    expect(continued.blocks[1]?.content).toContain('\\begin{aligned}');
    expect(continued.blocks[1]?.content).toMatch(/\n\$\$$/);
    expect(continued.state?.tailSource).toContain('$$');
  });

  it('holds reference links, incomplete definitions, and footnotes in one mutable tree', () => {
    const references = reconcileMarkdownRenderBlocks(
      null,
      'Intro.\n\nRead [the docs][docs].\n\nMore context.\n\n[docs]:',
      true,
    );

    expect(references.blocks).toHaveLength(2);
    expect(references.blocks[0]).toEqual({ content: 'Intro.', mutable: false });
    expect(references.blocks[1]?.mutable).toBe(true);
    expect(references.blocks[1]?.content).toContain('[the docs][docs]');
    expect(references.blocks[1]?.content).toContain('[docs]:');

    const footnotes = reconcileMarkdownRenderBlocks(
      null,
      'Intro.\n\nClaim[^note].\n\n[^note]: partial',
      true,
    );
    expect(footnotes.blocks).toHaveLength(2);
    expect(footnotes.blocks[1]?.content).toContain('Claim[^note]');
    expect(footnotes.blocks[1]?.content).toContain('[^note]: partial');
  });

  it('keeps shortcut references mutable until their definitions arrive', () => {
    const beforeDefinitions = [
      'Intro.',
      '',
      'See [docs] and ![diagram].',
      '',
      'More context.',
    ].join('\n');
    const pending = reconcileMarkdownRenderBlocks(null, beforeDefinitions, true);

    expect(pending.blocks).toHaveLength(2);
    expect(pending.blocks[0]).toEqual({ content: 'Intro.', mutable: false });
    expect(pending.blocks[1]?.mutable).toBe(true);
    expect(pending.blocks[1]?.content).toContain('See [docs] and ![diagram].');
    expect(pending.blocks[1]?.content).toContain('More context.');
    expect(pending.state?.tailSource).toContain('See [docs]');

    const resolved = reconcileMarkdownRenderBlocks(
      pending.state,
      `${beforeDefinitions}\n\n[docs]: https://example.com/docs\n[diagram]: diagram.png`,
      true,
    );
    expect(resolved.blocks).toHaveLength(2);
    expect(resolved.blocks[1]?.mutable).toBe(true);
    expect(resolved.blocks[1]?.content).toContain('[docs]: https://example.com/docs');
    expect(resolved.blocks[1]?.content).toContain('[diagram]: diagram.png');
  });

  it('drops synthetic tail repairs and performs a canonical parse on completion', () => {
    const streaming = reconcileMarkdownRenderBlocks(
      null,
      'Stable.\n\nCurrent **bold',
      true,
    );
    expect(streaming.blocks[1]).toEqual({ content: 'Current **bold**', mutable: true });

    const completed = reconcileMarkdownRenderBlocks(
      streaming.state,
      'Stable.\n\nCurrent **bold',
      false,
    );
    expect(completed.state).toBeNull();
    expect(completed.blocks).toEqual([
      { content: 'Stable.', mutable: false },
      { content: 'Current **bold', mutable: false },
    ]);
  });

  it('resets committed blocks when streaming content is rewritten', () => {
    const initial = reconcileMarkdownRenderBlocks(null, 'Old stable.\n\nTail.', true);
    const rewritten = reconcileMarkdownRenderBlocks(initial.state, 'Replacement.', true);

    expect(rewritten.blocks).toEqual([{ content: 'Replacement.', mutable: true }]);
    expect(rewritten.state?.stableContents).toEqual([]);
  });

  it('excludes top-level HTML that the renderer intentionally skips', () => {
    const markdown = [
      '```java',
      'pool.execute(() -> System.out.println("学习中"));',
      '```',
      '',
      '<details>',
      '<summary>点我看答案</summary>',
      '',
      '意思是：给线程池一个任务。',
      '</details>',
      '',
      '---',
    ].join('\n');
    const blocks = parseMarkdownBlocks(markdown);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('```java');
    expect(blocks[1]).toContain('意思是：给线程池一个任务。');
    expect(blocks[2]).toBe('---');
    expect(blocks.join('\n')).not.toContain('<details>');
    expect(blocks.join('\n')).not.toContain('<summary>');
  });
});
