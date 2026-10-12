// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceHeaderVisibility } from '../../../../../src/features/workspace/overview/useWorkspaceHeaderVisibility.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

it('syncs header visibility across panels and windows, preserving the prior preference on a failed save', () => {
  const key = 'setsuna.workspace-header-visible';
  window.localStorage.setItem(key, 'invalid');
  const onError = vi.fn();
  const first = renderHook(() => useWorkspaceHeaderVisibility(onError));
  const second = renderHook(() => useWorkspaceHeaderVisibility(vi.fn()));
  expect(first.result.current.headerVisible).toBe(true);

  act(() => { first.result.current.setHeaderVisible(false); });
  expect(first.result.current.headerVisible).toBe(false);
  expect(second.result.current.headerVisible).toBe(false);

  act(() => {
    window.localStorage.setItem(key, 'true');
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  expect(first.result.current.headerVisible).toBe(true);
  expect(second.result.current.headerVisible).toBe(true);

  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  act(() => { first.result.current.setHeaderVisible(false); });
  expect(first.result.current.headerVisible).toBe(true);
  expect(second.result.current.headerVisible).toBe(true);
  expect(onError).toHaveBeenCalledOnce();
});
