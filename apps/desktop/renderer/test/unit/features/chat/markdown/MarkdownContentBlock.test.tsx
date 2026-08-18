import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContentBlock } from '../../../../../src/features/chat/markdown/MarkdownContentBlock.js';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';

describe('MarkdownContentBlock links', () => {
  it('stops GFM autolinks before Chinese punctuation and preserves surrounding bold text', () => {
    const html = renderToStaticMarkup(
      <MarkdownNavigationProvider onOpenWebLink={() => undefined}>
        <MarkdownContentBlock content="开发服务器已启动在 **http://localhost:5173/**，进去就能看到效果。如果需要调整某个具体色彩或动效强度，随时说。 [邮件](mailto:hello@example.com)" />
      </MarkdownNavigationProvider>,
    );

    expect(html).toContain('href="http://localhost:5173/"');
    expect(html).not.toContain('href="http://localhost:5173/**');
    expect(html).toContain('<strong><a');
    expect(html).toContain('</a></strong>，进去就能看到效果。');
    expect(html.match(/data-markdown-link="web"/g)).toHaveLength(1);
    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).toContain('data-markdown-link="external"');
    expect(html.match(/chat-markdown__web-link-icon/g)).toHaveLength(1);
  });

  it('stops an unformatted GFM autolink before Chinese punctuation', () => {
    const html = renderToStaticMarkup(
      <MarkdownNavigationProvider onOpenWebLink={() => undefined}>
        <MarkdownContentBlock content="访问 http://localhost:5173/，然后继续。" />
      </MarkdownNavigationProvider>,
    );

    expect(html).toContain('href="http://localhost:5173/"');
    expect(html).toContain('</a>，然后继续。');
  });

  it('preserves bold around a bare URL when whitespace follows the closing marker', () => {
    const html = renderToStaticMarkup(
      <MarkdownNavigationProvider onOpenWebLink={() => undefined}>
        <MarkdownContentBlock content="地址：**http://localhost:5888/** (项目已配置固定端口)" />
      </MarkdownNavigationProvider>,
    );

    expect(html).toContain('<strong><a');
    expect(html).toContain('href="http://localhost:5888/"');
    expect(html).not.toContain('href="http://localhost:5888/**');
    expect(html).not.toContain('**');
  });
});
