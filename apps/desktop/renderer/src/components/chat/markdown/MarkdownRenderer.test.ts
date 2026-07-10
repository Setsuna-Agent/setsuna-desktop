import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownNavigationProvider } from './MarkdownNavigationProvider.js';
import { normalizeMarkdownCodeLanguage } from './MarkdownCodeBlock.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';

function renderMarkdown(content: string, streaming = false): string {
  return renderToStaticMarkup(
    createElement(
      MarkdownNavigationProvider,
      {
        onOpenWorkspaceFile: () => undefined,
        workspaceRoot: '/Users/dev/project',
      },
      createElement(MarkdownRenderer, { content, streaming }),
    ),
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

  it('repairs the mutable streaming tail without changing stable block markers', () => {
    const html = renderMarkdown('Stable.\n\nStreaming **bold', true);

    expect(html).toContain('data-markdown-block="stable"');
    expect(html).toContain('data-markdown-block="mutable"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('chat-markdown is-streaming');
  });

  it('maps workspace links and does not render raw HTML', () => {
    const html = renderMarkdown('[source](./src/main.ts:12)\n\n<script>alert(1)</script>');

    expect(html).toContain('data-markdown-link="workspace"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('keeps fenced code on the existing code highlighter path', () => {
    const html = renderMarkdown('```ts\nconst answer = 42;\n```');

    expect(html).toContain('chat-code-highlighter');
    expect(html).toContain('TS');
    expect(html).toContain('const answer = 42;');
    expect(normalizeMarkdownCodeLanguage('TSX')).toBe('typescript');
    expect(normalizeMarkdownCodeLanguage('')).toBe('');
  });
});
