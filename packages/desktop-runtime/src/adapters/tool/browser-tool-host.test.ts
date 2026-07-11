import { describe, expect, it } from 'vitest';
import { BrowserToolHost, normalizeBrowserToolUrl } from './browser-tool-host.js';

describe('BrowserToolHost', () => {
  it('exposes an unapproved browser tool with a structured UI action', async () => {
    const host = new BrowserToolHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'open_browser' }),
    ]);
    await expect(host.approvalForTool()).resolves.toBeNull();
    await expect(host.runTool('open_browser', { url: 'www.baidu.com' }, context)).resolves.toMatchObject({
      content: 'Opened https://www.baidu.com/ in the side browser.',
      data: { kind: 'browser.open', url: 'https://www.baidu.com/' },
    });
  });

  it('rejects unsupported protocols', () => {
    expect(() => normalizeBrowserToolUrl({ url: 'file:///tmp/example.html' })).toThrow('Unsupported browser URL protocol');
    expect(() => normalizeBrowserToolUrl({ url: 'javascript:alert(1)' })).toThrow('Unsupported browser URL protocol');
  });
});
