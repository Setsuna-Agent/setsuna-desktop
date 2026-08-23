import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BROWSER_URL } from '../../src/contracts/index.js';
import {
  BrowserPanel,
  nextBrowserZoomFactor,
  normalizeBrowserInput,
  resolveBrowserFaviconUrl,
  resolveBrowserFaviconUrls,
} from '../../src/renderer/BrowserPanel.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';
import { browserScreenshotOutcomeFeedback } from '../../src/renderer/useBrowserScreenshot.js';

const translate = (key: Parameters<typeof translateBrowserMessage>[1]) => (
  translateBrowserMessage('zh-CN', key)
);

describe('normalizeBrowserInput', () => {
  it('uses the internal home page for an empty address', () => {
    expect(normalizeBrowserInput('  ')).toBe(DEFAULT_BROWSER_URL);
  });

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

  it('retains later supported favicon candidates for retry', () => {
    expect(resolveBrowserFaviconUrls([
      'https://example.com/missing.ico',
      'https://example.com/icon.png',
    ])).toEqual([
      'https://example.com/missing.ico',
      'https://example.com/icon.png',
    ]);
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

describe('browserScreenshotOutcomeFeedback', () => {
  it('maps screenshot outcomes to the shared toast tones', () => {
    expect(browserScreenshotOutcomeFeedback('added')).toEqual({
      message: '截图已添加到输入框，并复制到剪切板',
      tone: 'success',
    });
    expect(browserScreenshotOutcomeFeedback('unsupported').tone).toBe('warning');
    expect(browserScreenshotOutcomeFeedback('limit-reached').tone).toBe('warning');
    expect(browserScreenshotOutcomeFeedback('unavailable').tone).toBe('warning');
  });
});

describe('BrowserPanel', () => {
  it('renders the internal history home without creating a webview', () => {
    const html = renderToStaticMarkup(createElement(BrowserPanel, {
      bridge: null,
      hidden: false,
      notify: () => undefined,
      panel: browserPanel('browser-home'),
      translate,
      onPanelMetadataChange: () => undefined,
    }));

    expect(html).toContain('从这里继续浏览');
    expect(html).toContain('还没有浏览记录');
    expect(html).not.toContain('<webview');
    expect(html).not.toContain('www.bing.com');
  });

  it('enables Electron popup requests on the embedded webview', () => {
    const html = renderToStaticMarkup(createElement(BrowserPanel, {
      bridge: null,
      hidden: false,
      notify: () => undefined,
      panel: browserPanel('browser-1', 'https://example.com/'),
      translate,
      onPanelMetadataChange: () => undefined,
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
      bridge: null,
      hidden: false,
      notify: () => undefined,
      panel: browserPanel('browser-event-1', 'https://www.baidu.com/'),
      translate,
      onPanelMetadataChange: () => undefined,
    }));

    expect(html).toContain('src="https://www.baidu.com/"');
    expect(html).not.toContain('src="https://www.bing.com/"');
  });
});

function browserPanel(id: string, url = DEFAULT_BROWSER_URL) {
  return {
    browser: { faviconUrl: null, loading: url !== DEFAULT_BROWSER_URL, url },
    id,
    title: '新标签页',
  };
}
