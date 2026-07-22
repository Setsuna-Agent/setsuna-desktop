import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  normalizeMarkdownCodeLanguage,
  shouldSyntaxHighlightMarkdownCode,
} from '../../../../../src/features/chat/markdown/MarkdownCodeBlock.js';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import { MarkdownRenderer } from '../../../../../src/features/chat/markdown/MarkdownRenderer.js';
import {
  estimateMarkdownBlockHeight,
  shouldVirtualizeMarkdownBlocks,
} from '../../../../../src/features/chat/markdown/MarkdownVirtualBlock.js';

function renderMarkdown(content: string, streaming = false): string {
  const children = createElement(MarkdownRenderer, { content, streaming });
  return renderToStaticMarkup(
    createElement(MarkdownNavigationProvider, {
      children,
      onOpenWorkspaceFile: () => undefined,
      workspaceRoot: '/Users/dev/project',
    }),
  );
}

describe('MarkdownRenderer', () => {
  it('renders project-owned typography elements and table containment', () => {
    const html = renderMarkdown('# Heading\n\n1. First\n2. Second\n\n| A | B |\n| - | - |\n| 1 | 2 |');

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<ol>');
    expect(html).toContain('class="chat-markdown__table-scroll"');
    expect(html).toContain('<table>');
  });

  it('renders GFM task items as ordinary list items without checkboxes', () => {
    const html = renderMarkdown('- [ ] Use `path.join`\n- [x] Done');

    expect(html).toContain('<ul class="contains-task-list">');
    expect(html).toMatch(/<li class="task-list-item">\s*Use <code>path\.join<\/code><\/li>/);
    expect(html).toMatch(/<li class="task-list-item">\s*Done<\/li>/);
    expect(html).not.toContain('<input');
  });

  it('repairs the mutable streaming tail without changing stable block markers', () => {
    const html = renderMarkdown('Stable.\n\nStreaming **bold', true);

    expect(html).toContain('data-markdown-block="stable"');
    expect(html).toContain('data-markdown-block="mutable"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('is-streaming');
    expect(html).not.toContain('chat-markdown__empty-tail');
  });

  it('renders inline and display math with KaTeX', () => {
    const html = renderMarkdown('Inline $x^2$\n\n$$\n\\lim_{x \\to 0} \\frac{\\sin 3x}{\\sin 5x}\n$$');
    const compactMathHtml = renderMarkdown('$$\\lim_{x \\to 0} \\frac{\\sin 3x}{\\sin 5x}$$');

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('$$');
    expect(compactMathHtml).toContain('class="katex"');
    expect(compactMathHtml).not.toContain('$$');
  });

  it('repairs incomplete display math while streaming', () => {
    const html = renderMarkdown('$$\n\\frac{1}{2}', true);

    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('$$');
  });

  it('maps workspace links and does not render raw HTML', () => {
    const html = renderMarkdown('[source](./src/main.ts:12)\n\n<script>alert(1)</script>');

    expect(html).toContain('data-markdown-link="workspace"');
    expect(html).toContain('class="chat-markdown__file-link"');
    expect(html).toContain('class="chat-markdown__file-icon"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('promotes inline code file references without changing identifiers', () => {
    const html = renderMarkdown('Update `help.ts` and keep `invoice_status` unchanged.');

    expect(html).toContain('data-markdown-link="workspace-inline"');
    expect(html).toContain('>help.ts</span>');
    expect(html).toContain('<code>invoice_status</code>');
  });

  it('keeps fenced code on the existing code highlighter path', () => {
    const html = renderMarkdown('```ts\nconst answer = 42;\n```');

    expect(html).toContain('chat-code-highlighter');
    expect(html).toContain('>ts</span>');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain('const answer = 42;');
    expect(normalizeMarkdownCodeLanguage('TSX')).toBe('typescript');
    expect(normalizeMarkdownCodeLanguage('')).toBe('');
  });

  it('renders unlabelled fenced code as a contained plain code block', () => {
    const html = renderMarkdown('```\nChatWorkspace.tsx\n├── useChatWorkspaceState.ts\n```');

    expect(html).toContain('chat-code-highlighter chat-code-highlighter--plain');
    expect(html).toContain('>plain text</span>');
    expect(html).toContain('<pre><code>ChatWorkspace.tsx\n├── useChatWorkspaceState.ts</code></pre>');
  });

  it('skips token-by-token highlighting for very large code blocks', () => {
    const code = Array.from({ length: 501 }, (_, index) => `line ${index}`).join('\n');
    const html = renderMarkdown(`\`\`\`text\n${code}\n\`\`\``);

    expect(shouldSyntaxHighlightMarkdownCode(code)).toBe(false);
    expect(html).toContain('chat-code-highlighter--plain');
    expect(html).toContain('line 500');
    expect(html).toContain('aria-label="复制代码"');
  });

  it('enables block virtualization only for costly markdown documents', () => {
    const shortBlocks = [{ content: 'Short paragraph.' }];
    const manyBlocks = Array.from({ length: 24 }, (_, index) => ({ content: `Paragraph ${index}` }));

    expect(shouldVirtualizeMarkdownBlocks(shortBlocks)).toBe(false);
    expect(shouldVirtualizeMarkdownBlocks(manyBlocks)).toBe(true);
    expect(shouldVirtualizeMarkdownBlocks([{ content: 'x'.repeat(16_000) }])).toBe(true);
    expect(estimateMarkdownBlockHeight('```ts\nconst value = 1;\n```')).toBeGreaterThan(60);
  });
});
