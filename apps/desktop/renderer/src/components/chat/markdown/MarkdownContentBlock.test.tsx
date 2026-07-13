import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContentBlock } from './MarkdownContentBlock.js';
import { MarkdownNavigationProvider } from './MarkdownNavigationProvider.js';

describe('MarkdownContentBlock links', () => {
  it('adds a Web icon to HTTP links without decorating non-Web external links', () => {
    const html = renderToStaticMarkup(
      <MarkdownNavigationProvider onOpenWebLink={() => undefined}>
        <MarkdownContentBlock content="[Setsuna](https://example.com/docs) [邮件](mailto:hello@example.com)" />
      </MarkdownNavigationProvider>,
    );

    expect(html).toContain('data-markdown-link="web"');
    expect(html).toContain('chat-markdown__web-link-icon');
    expect(html).toContain('data-markdown-link="external"');
    expect(html.match(/chat-markdown__web-link-icon/g)).toHaveLength(1);
  });
});
