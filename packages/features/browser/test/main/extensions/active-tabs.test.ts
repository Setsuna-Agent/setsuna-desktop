import { EventEmitter } from 'node:events';
import type { Extension, WebContents } from 'electron';
import { expect, it } from 'vitest';
import { BrowserExtensionActiveTabs } from '../../../src/main/extensions/active-tabs.js';

function tab(id: number, initial = 'https://example.test/') {
  let url = initial; let destroyed = false;
  const contents = Object.assign(new EventEmitter(), { id, getURL: () => url, isDestroyed: () => destroyed }) as unknown as WebContents;
  return { contents, navigate(next: string, committed = true) {
    if (committed) url = next;
    contents.emit(committed ? 'did-navigate' : 'did-start-navigation', {}, next);
  }, close() { destroyed = true; contents.emit('destroyed'); } };
}
const extension = (id: string, permissions = ['activeTab']) => ({ id, manifest: { permissions } }) as unknown as Extension;

it('retains grants for same-origin documents and cancelled navigations, and revokes committed origin changes permanently', () => {
  for (const destination of ['https://other.test/', 'https://sub.example.test/', 'http://example.test/', 'https://example.test:8443/']) {
    const current = tab(1);
    const grants = new BrowserExtensionActiveTabs(() => true); grants.track(current.contents);
    expect(grants.grant(extension('one'), current.contents)).toBe(true);
    current.navigate('https://example.test/next#hash');
    current.navigate(destination, false);
    expect(grants.has('one', current.contents)).toBe(true);
    current.navigate(destination);
    expect(grants.has('one', current.contents)).toBe(false);
    current.navigate('https://example.test/');
    expect(grants.has('one', current.contents)).toBe(false);
    grants.grant(extension('one'), current.contents);
    // Commit notifications retain their own URL even if a newer navigation is already visible.
    current.contents.emit('did-navigate', {}, destination);
    expect(grants.has('one', current.contents)).toBe(false);
    grants.dispose();
  }
});

it('isolates grants by extension and owned tab, and clears them on unload, close and untracking', () => {
  const first = tab(1); const second = tab(2); const foreign = tab(3);
  const grants = new BrowserExtensionActiveTabs(contents => contents.id !== foreign.contents.id);
  const untrack = grants.track(first.contents); grants.track(second.contents); grants.track(foreign.contents);
  expect(grants.grant(extension('one', []), first.contents)).toBe(false);
  expect(grants.grant(extension('one'), foreign.contents)).toBe(false);
  grants.grant(extension('one'), first.contents); grants.grant(extension('two'), first.contents);
  expect(grants.has('one', second.contents)).toBe(false);
  grants.remove('one');
  expect(grants.has('one', first.contents)).toBe(false);
  expect(grants.has('two', first.contents)).toBe(true);
  untrack(); expect(grants.has('two', first.contents)).toBe(false);
  grants.grant(extension('one'), second.contents); second.close();
  expect(grants.has('one', second.contents)).toBe(false);
  grants.dispose();
});

it('never grants access to privileged schemes or the extension store', () => {
  for (const url of ['file:///private/data', 'about:blank', 'chrome://extensions/', 'chrome-extension://private/page.html',
    'https://chromewebstore.google.com/detail/example', 'https://chrome.google.com/webstore/detail/example']) {
    const current = tab(1, url); const grants = new BrowserExtensionActiveTabs(() => true); grants.track(current.contents);
    expect(grants.grant(extension('one'), current.contents)).toBe(false);
    expect(grants.has('one', current.contents)).toBe(false);
    grants.dispose();
  }
});
