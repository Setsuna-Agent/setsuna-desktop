import { describe, expect, it, vi } from 'vitest';
import {
  isAllowedEmbeddedBrowserUrl,
  requestEmbeddedBrowserNewTab,
} from '../../src/main/new-tab.js';

describe('embedded browser new-tab routing', () => {
  it('routes an allowed guest popup to the host renderer', () => {
    const send = vi.fn();

    const routed = requestEmbeddedBrowserNewTab({
      isDestroyed: () => false,
      send,
    }, 42, 'https://example.com/docs');

    expect(routed).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('browser:open-new-tab', {
      openerWebContentsId: 42,
      url: 'https://example.com/docs',
    });
  });

  it.each([
    ['a blocked scheme', 'javascript:alert(1)', false],
    ['an invalid URL', 'not a url', false],
    ['the empty guest page', 'about:blank', true],
  ])('classifies %s', (_label, url, expected) => {
    expect(isAllowedEmbeddedBrowserUrl(url)).toBe(expected);
  });

  it('does not route to a destroyed host', () => {
    const send = vi.fn();

    const routed = requestEmbeddedBrowserNewTab({
      isDestroyed: () => true,
      send,
    }, 42, 'https://example.com/docs');

    expect(routed).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
