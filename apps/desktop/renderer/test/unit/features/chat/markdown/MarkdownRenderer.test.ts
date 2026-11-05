import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  normalizeMarkdownCodeBlockContents, shouldSyntaxHighlightMarkdownCode
} from '../../../../../src/features/chat/markdown/MarkdownCodeBlock.js';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import { MarkdownRenderer } from '../../../../../src/features/chat/markdown/MarkdownRenderer.js';
import { I18nProvider, type AppLocale } from '../../../../../src/shared/i18n/I18nProvider.js';

function renderMarkdown(
  content: string,
  streaming = false,
  locale: AppLocale = 'zh-CN',
  legacyThinkingTags = true,
): string {
  const children = createElement(MarkdownRenderer, { content, legacyThinkingTags, streaming });
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      { initialLocale: locale },
      createElement(MarkdownNavigationProvider, {
        children,
        onOpenWorkspaceFile: () => undefined,
        workspaceRoot: '/Users/dev/project',
      }),
    ),
  );
}

describe('MarkdownRenderer', () => {

  it('keeps reference definitions with their mutable uses while preserving the stable prefix', () => {
    const html = renderMarkdown(
      'Stable intro.\n\nRead [the docs][docs].\n\n[docs]: https://example.com/docs',
      true,
    );

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('>the docs<');
  });

  it('keeps unverified workspace links non-interactive and does not render raw HTML', () => {
    const html = renderMarkdown('[source](./src/main.ts:12)\n\n<script>alert(1)</script>');
    expect(html).not.toContain('data-markdown-link="workspace"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('does not interpret tag examples in structured visible content as reasoning boundaries', () => {
    const html = renderMarkdown(
      'Use raw <think>literal</think> and code `<think>` as protocol examples.',
      false,
      'zh-CN',
      false,
    );

    expect(html).toContain('raw &lt;think&gt;literal&lt;/think&gt;');
    expect(html).toContain('<code>&lt;think&gt;</code>');
    expect(html).toContain('as protocol examples.');
  });

  it('does not truncate legacy visible content that mentions think tags as inline code', () => {
    const html = renderMarkdown('审查范围主要是将 `<think>` 标签迁移为 `streamParts`。');

    expect(html).toContain('审查范围主要是将');
    expect(html).toContain('<code>&lt;think&gt;</code>');
    expect(html).toContain('标签迁移为');
    expect(html).toContain('<code>streamParts</code>');
  });

  it('keeps inline file references as code until their existence is verified', () => {
    const html = renderMarkdown('Update `help.ts` and keep `invoice_status` unchanged.');

    expect(html).not.toContain('data-markdown-link="workspace-inline"');
    expect(html).toContain('<code>help.ts</code>');
    expect(html).toContain('<code>invoice_status</code>');
  });

  it('removes parser and authored blank lines from the end of fenced code', () => {
    expect(normalizeMarkdownCodeBlockContents('pnpm build\n✓ tsc\n✓ vite build\n\n')).toBe(
      'pnpm build\n✓ tsc\n✓ vite build',
    );
    expect(normalizeMarkdownCodeBlockContents('const value = 1;\r\n  \r\n')).toBe('const value = 1;');
  });

  it('skips token-by-token highlighting for very large code blocks', () => {
    const code = Array.from({ length: 501 }, (_, index) => `line ${index}`).join('\n');
    expect(shouldSyntaxHighlightMarkdownCode(code)).toBe(false);
  });

});
