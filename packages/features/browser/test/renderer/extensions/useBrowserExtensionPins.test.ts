// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BROWSER_EXTENSION_PINS_KEY, useBrowserExtensionPins } from '../../../src/renderer/extensions/useBrowserExtensionPins.js';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(BROWSER_EXTENSION_PINS_KEY);
});

it('shares pin changes between mounted panels and restores the persisted selection', () => {
  const first = renderHook(useBrowserExtensionPins);
  const second = renderHook(useBrowserExtensionPins);
  const a = 'a'.repeat(32);
  const b = 'b'.repeat(32);
  act(() => first.result.current.togglePin(a));
  expect(second.result.current.pinnedIds).toEqual([a]);
  act(() => second.result.current.togglePin(b));
  expect(first.result.current.pinnedIds).toEqual([a, b]);
  act(() => first.result.current.togglePin(a));
  expect(second.result.current.pinnedIds).toEqual([b]);
  first.unmount();
  second.unmount();
  expect(renderHook(useBrowserExtensionPins).result.current.pinnedIds).toEqual([b]);
});

it('accepts storage changes from another window and recovers from invalid saved data', () => {
  window.localStorage.setItem(BROWSER_EXTENSION_PINS_KEY, '{broken');
  const pins = renderHook(useBrowserExtensionPins);
  expect(pins.result.current.pinnedIds).toEqual([]);
  const id = 'c'.repeat(32);
  act(() => {
    window.localStorage.setItem(BROWSER_EXTENSION_PINS_KEY, JSON.stringify([null, id, id, '../outside']));
    window.dispatchEvent(new StorageEvent('storage', { key: BROWSER_EXTENSION_PINS_KEY }));
  });
  expect(pins.result.current.pinnedIds).toEqual([id]);
  act(() => {
    window.localStorage.removeItem(BROWSER_EXTENSION_PINS_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  expect(pins.result.current.pinnedIds).toEqual([]);
});
