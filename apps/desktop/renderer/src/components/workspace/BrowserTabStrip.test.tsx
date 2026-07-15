import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrowserTabStrip } from './BrowserTabStrip.js';

describe('BrowserTabStrip', () => {
  it('renders browser tabs with the shared header tab semantics', () => {
    const html = renderToStaticMarkup(
      <BrowserTabStrip
        activeTabId="browser-tab-2"
        tabs={[
          { faviconUrl: 'https://example.com/favicon.ico', id: 'browser-tab-1', loading: false, title: 'Setsuna' },
          { faviconUrl: null, id: 'browser-tab-2', loading: true, title: '文档' },
        ]}
        onCloseTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="浏览器标签页"');
    expect(html).toContain('title="Setsuna"');
    expect(html).toContain('title="文档"');
    expect(html).toContain('src="https://example.com/favicon.ico"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="关闭文档"');
    expect(html).not.toContain('aria-label="新建浏览器标签页"');
  });
});
