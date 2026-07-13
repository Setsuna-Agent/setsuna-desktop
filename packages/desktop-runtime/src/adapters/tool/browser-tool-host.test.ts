import { describe, expect, it } from 'vitest';
import type { BrowserControlPort } from '../../ports/browser-control.js';
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

  it('exposes page controls when the Electron bridge is available', async () => {
    const calls: unknown[] = [];
    const control: BrowserControlPort = {
      async execute(command) {
        calls.push(command);
        if (command.kind === 'snapshot') {
          return {
            elements: [{ name: 'Search', ref: 's1:t0:n1', role: 'textbox', tag: 'input' }],
            kind: 'snapshot',
            tabId: 'tab-1',
            text: 'Example page',
            title: 'Example',
            url: 'https://example.com/',
          };
        }
        return { kind: 'tabs', tabs: [] };
      },
    };
    const host = new BrowserToolHost(control);
    const tools = await host.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'open_browser',
      'browser_tabs',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_scroll',
      'browser_key',
      'browser_navigate',
      'browser_wait',
    ]);
    await expect(host.runTool('open_browser', { url: 'example.com' }, { threadId: 'thread_1' })).resolves.toMatchObject({
      data: { kind: 'tabs', tabs: [] },
    });
    await expect(host.runTool('browser_snapshot', { tabId: 'tab-1' }, { threadId: 'thread_1' })).resolves.toMatchObject({
      containsExternalContext: true,
      content: expect.stringContaining('[s1:t0:n1] textbox "Search"'),
    });
    expect(calls).toEqual([
      { kind: 'open', url: 'https://example.com/' },
      { kind: 'snapshot', maxElements: undefined, tabId: 'tab-1' },
    ]);
  });

  it('requires approval for click and type without exposing typed text', async () => {
    const host = new BrowserToolHost({ execute: async () => ({ kind: 'tabs', tabs: [] }) });

    await expect(host.approvalForTool('browser_click', { ref: 's1:t0:n1' })).resolves.toMatchObject({
      reason: expect.stringContaining('点击网页元素'),
    });
    const typing = await host.approvalForTool('browser_type', { ref: 's1:t0:n2', text: 'private value' });
    expect(typing?.argumentsPreview).toContain('"textLength":13');
    expect(typing?.argumentsPreview).not.toContain('private value');
    await expect(host.approvalForTool('browser_key', { key: 'Enter' })).resolves.toMatchObject({
      reason: expect.stringContaining('提交表单'),
    });
    await expect(host.approvalForTool('browser_key', { key: 'Tab' })).resolves.toBeNull();
  });
});
