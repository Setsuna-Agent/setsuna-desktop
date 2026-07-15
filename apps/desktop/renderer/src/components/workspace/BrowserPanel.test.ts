import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserPanel, nextBrowserZoomFactor, normalizeBrowserInput, resolveBrowserFaviconUrl } from './BrowserPanel.js';
import { createBrowserPanel } from './model.js';

describe('normalizeBrowserInput', () => {
  it('keeps absolute web URLs', () => {
    expect(normalizeBrowserInput('https://example.com/docs')).toBe('https://example.com/docs');
  });

  it('adds a secure scheme to host names', () => {
    expect(normalizeBrowserInput('example.com/docs')).toBe('https://example.com/docs');
  });

  it('allows local development addresses over http', () => {
    expect(normalizeBrowserInput('localhost:5174')).toBe('http://localhost:5174');
  });

  it('uses search for plain text', () => {
    expect(normalizeBrowserInput('setsuna desktop')).toBe('https://www.bing.com/search?q=setsuna%20desktop');
  });
});

describe('resolveBrowserFaviconUrl', () => {
  it('uses the first supported favicon URL', () => {
    expect(resolveBrowserFaviconUrl(['javascript:alert(1)', 'https://example.com/favicon.ico'])).toBe('https://example.com/favicon.ico');
    expect(resolveBrowserFaviconUrl(['data:image/png;base64,aWNvbg=='])).toBe('data:image/png;base64,aWNvbg==');
  });

  it('rejects unsupported favicon URLs', () => {
    expect(resolveBrowserFaviconUrl(['javascript:alert(1)', 'file:///tmp/favicon.ico'])).toBeNull();
  });
});

describe('nextBrowserZoomFactor', () => {
  it('moves between bounded browser zoom steps', () => {
    expect(nextBrowserZoomFactor(1, 'in')).toBe(1.1);
    expect(nextBrowserZoomFactor(1, 'out')).toBe(0.9);
    expect(nextBrowserZoomFactor(3, 'in')).toBe(3);
    expect(nextBrowserZoomFactor(0.5, 'out')).toBe(0.5);
    expect(nextBrowserZoomFactor(1.75, 'reset')).toBe(1);
  });
});

describe('BrowserPanel', () => {
  it('allows popup requests so main can route them into ordinary workspace tabs', () => {
    const html = renderToStaticMarkup(createElement(BrowserPanel, {
      hidden: false,
      panel: createBrowserPanel('browser-1'),
      onPanelMetadataChange: () => undefined,
      onResizeStart: () => undefined,
      onResizeStep: () => undefined,
      resizeMax: 960,
      resizeMin: 320,
      resizeValue: 640,
    }));

    expect(html).toContain('allowpopups="true"');
    expect(html).not.toContain('desktop-browser-tabs');
    expect(html).toContain('desktop-browser-address-bar__external');
    expect(html).toContain('aria-label="浏览器菜单"');
    expect(html).toContain('aria-label="浏览器窗口设置"');
    expect(html).toContain('打印页面');
    expect(html).toContain('获取屏幕截图');
    expect(html).toContain('显示设备工具栏');
    expect(html).toContain('100%');
    expect(html).toContain('打开开发者工具');
  });

  it('uses an AI browser request as the initial tab URL', () => {
    const html = renderToStaticMarkup(createElement(BrowserPanel, {
      hidden: false,
      panel: createBrowserPanel('browser-event-1', 'https://www.baidu.com/'),
      onPanelMetadataChange: () => undefined,
      onResizeStart: () => undefined,
      onResizeStep: () => undefined,
      resizeMax: 960,
      resizeMin: 320,
      resizeValue: 640,
    }));

    expect(html).toContain('src="https://www.baidu.com/"');
    expect(html).not.toContain('src="https://www.bing.com/"');
  });
});
