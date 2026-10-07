import { EventEmitter } from 'node:events';
import type { BrowserWindow, Extension } from 'electron';
import { expect, it, vi } from 'vitest';
import { BrowserExtensionSidePanels } from '../../../src/main/extensions/side-panels.js';
import { ExtensionSidePanelOptions } from '../../../src/main/extensions/side-panel-options.js';

vi.mock('electron', () => ({ nativeImage: {} }));
const extension = { id: 'a'.repeat(32), manifest: { permissions: ['sidePanel'], side_panel: { default_path: 'panel.html' } } } as Extension;
const owner = (id: number) => Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) as unknown as BrowserWindow;

it('toggles a global panel across tabs but keeps same-path tab panels distinct', () => {
  const window = owner(1);
  const changed = vi.fn(); const notify = vi.fn();
  const panels = new BrowserExtensionSidePanels(changed, notify);
  panels.show(extension, window, 10);
  const global = panels.snapshot(window);
  panels.show(extension, window, 20);
  expect(panels.snapshot(window)).toBe(global);
  expect(changed).toHaveBeenCalledOnce();
  panels.show(extension, window, 20, true);
  expect(panels.snapshot(window)).toBeNull();
  expect(notify).toHaveBeenLastCalledWith(extension.id, { kind: 'panelClosed', windowId: 1, path: 'panel.html' });
  for (const tabId of [10, 20]) panels.options.set(extension, { tabId, path: 'panel.html' }, () => true);
  panels.show(extension, window, 10);
  panels.show(extension, window, 20, true);
  expect(panels.snapshot(window)?.webContentsId).toBe(20);
  panels.show(extension, window, 20, true);
  expect(panels.snapshot(window)).toBeNull();
  panels.dispose();
});

it('validates extension origins and owned tabs, and isolates per-tab options and extension behavior', () => {
  const options = new ExtensionSidePanelOptions();
  const owns = (id: number) => [10, 20].includes(id);
  options.set(extension, { path: 'global.html', enabled: true }, owns);
  options.set(extension, { tabId: 10, path: 'specific.html' }, owns);
  expect(options.get(extension, 10)).toEqual({ tabId: 10, path: 'specific.html', enabled: true });
  expect(options.get(extension, 20)).toEqual({ tabId: 20, path: 'global.html', enabled: true });
  for (const path of ['https://example.com/', `chrome-extension://${'b'.repeat(32)}/panel.html`, '//example.com/panel.html']) {
    expect(() => options.set(extension, { path }, owns)).toThrow();
  }
  expect(() => options.set(extension, { tabId: 99, enabled: false }, owns)).toThrow();
  expect(() => options.setBehavior(extension.id, { openPanelOnActionClick: 'true' })).toThrow();
  options.setBehavior(extension.id, { openPanelOnActionClick: true });
  expect(options.togglesOnAction(extension.id)).toBe(true);
  options.forgetTab(10);
  expect(options.get(extension, 10).path).toBe('global.html');
  options.remove(extension.id);
  expect(options.get(extension).path).toBe('panel.html');
  expect(options.togglesOnAction(extension.id)).toBe(false);
});

it('scopes open panels to their owner and tab, replaces stale paths, and cleans up on close or unload', () => {
  const first = owner(1); const second = owner(2);
  const changed = vi.fn(); const notify = vi.fn();
  const panels = new BrowserExtensionSidePanels(changed, notify);
  panels.options.set(extension, { tabId: 10, path: 'specific.html' }, () => true);
  expect(panels.show(extension, first, 10)).toBe(true);
  expect(panels.snapshot(second, 10)).toBeNull();
  expect(panels.snapshot(first, 20)).toBeNull();
  expect(panels.snapshot(first, 10)?.url).toContain('/specific.html');
  expect(panels.snapshot(first)?.webContentsId).toBe(10);
  panels.options.set(extension, { tabId: 10, enabled: false }, () => true);
  panels.refresh(extension);
  expect(panels.snapshot(first, 10)).toBeNull();
  expect(panels.show(extension, first, 10)).toBe(false);
  expect(panels.show(extension, first, 20)).toBe(true);
  expect(panels.snapshot(first, 10)?.webContentsId).toBeUndefined();
  expect(panels.close(first, 'b'.repeat(32))).toBe(false);
  panels.options.set(extension, { path: 'replacement.html' }, () => true);
  panels.refresh(extension);
  expect(panels.snapshot(first)?.url).toContain('/replacement.html');
  panels.remove(extension.id);
  expect(panels.snapshot(first)).toBeNull();
  expect(first.listenerCount('closed')).toBe(0);
  panels.show(extension, second);
  second.emit('closed');
  expect(panels.snapshot(second)).toBeNull();
  expect(notify.mock.calls.map(([, event]) => event.kind)).toContain('panelClosed');
});
