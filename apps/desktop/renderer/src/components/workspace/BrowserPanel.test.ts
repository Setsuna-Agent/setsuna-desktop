import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserPanel, normalizeBrowserInput, resolveBrowserFaviconUrl } from './BrowserPanel.js';

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

describe('BrowserPanel', () => {
  it('allows popup requests so main can route them into internal tabs', () => {
    const html = renderToStaticMarkup(createElement(BrowserPanel, {
      hidden: false,
      onResizeStart: () => undefined,
      onResizeStep: () => undefined,
      resizeMax: 960,
      resizeMin: 320,
      resizeValue: 640,
    }));

    expect(html).toContain('allowpopups="true"');
    expect(html).not.toContain('desktop-browser-tabs');
  });

  it('uses an AI browser request as the initial tab URL', () => {
    const html = renderToStaticMarkup(createElement(BrowserPanel, {
      hidden: false,
      openRequest: { id: 'event_1', url: 'https://www.baidu.com/' },
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
