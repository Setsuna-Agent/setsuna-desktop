// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceBackground } from '../../../../../src/features/workspace/overview/useWorkspaceBackground.js';

const store = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Blob | null>>(),
  write: vi.fn<(image: Blob | null) => Promise<void>>(),
  prepare: vi.fn<(file: File) => Promise<Blob>>(),
}));
vi.mock('../../../../../src/features/workspace/overview/workspaceBackground.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  readWorkspaceBackground: store.read,
  writeWorkspaceBackground: store.write,
  prepareWorkspaceBackground: store.prepare,
}));

class Updates {
  static instances: Updates[] = [];
  onmessage: (() => void) | null = null;
  close = vi.fn();
  constructor() { Updates.instances.push(this); }
}

beforeEach(() => {
  window.localStorage.clear();
  store.read.mockReset().mockResolvedValue(null);
  store.write.mockReset().mockResolvedValue(undefined);
  store.prepare.mockReset().mockResolvedValue(new Blob(['converted'], { type: 'image/webp' }));
  Updates.instances = [];
  vi.stubGlobal('BroadcastChannel', Updates);
  let sequence = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:background-${++sequence}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const file = () => new File(['image'], 'wallpaper.png', { type: 'image/png' });

it('keeps the panel usable during a slow load and does not replace a newer saved image with the late result', async () => {
  let finishRead!: (image: Blob) => void;
  store.read.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
  const { result } = renderHook(() => useWorkspaceBackground(vi.fn()));
  expect(result.current.busy).toBe(false);
  expect(result.current.url).toBeNull();
  await act(async () => { await result.current.change(file()); });
  expect(result.current.url).toBe('blob:background-1');
  expect(store.write).toHaveBeenCalledExactlyOnceWith(await store.prepare.mock.results[0].value);
  await act(async () => { finishRead(new Blob(['old'], { type: 'image/webp' })); });
  expect(result.current.url).toBe('blob:background-1');
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
});

it('preserves the saved background on failed or invalid uploads, and clears it only after reset is committed', async () => {
  store.read.mockResolvedValue(new Blob(['saved'], { type: 'image/webp' }));
  const onError = vi.fn();
  const { result } = renderHook(() => useWorkspaceBackground(onError));
  await waitFor(() => expect(result.current.url).toBe('blob:background-1'));
  store.write.mockRejectedValueOnce(new Error('quota'));
  await act(async () => { await result.current.change(file()); });
  expect(onError).toHaveBeenLastCalledWith('save');
  expect(result.current.url).toBe('blob:background-1');
  await act(async () => { await result.current.change(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })); });
  expect(onError).toHaveBeenLastCalledWith('invalid');
  expect(store.write).toHaveBeenCalledOnce();

  let finishReset!: () => void;
  store.write.mockReturnValueOnce(new Promise((resolve) => { finishReset = resolve; }));
  let reset!: Promise<void>;
  act(() => { reset = result.current.change(null); });
  expect(result.current.url).toBe('blob:background-1');
  expect(result.current.busy).toBe(true);
  await act(async () => { finishReset(); await reset; });
  expect(result.current.url).toBeNull();
  expect(store.write).toHaveBeenLastCalledWith(null);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:background-1');
});

it('refreshes background changes from another panel and releases image URLs and subscriptions on unmount', async () => {
  store.read.mockResolvedValueOnce(new Blob(['first'], { type: 'image/webp' }));
  const { result, unmount } = renderHook(() => useWorkspaceBackground(vi.fn()));
  await waitFor(() => expect(result.current.url).toBe('blob:background-1'));
  store.read.mockResolvedValueOnce(new Blob(['second'], { type: 'image/webp' }));
  await act(async () => { Updates.instances[0].onmessage?.(); });
  expect(result.current.url).toBe('blob:background-2');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:background-1');
  unmount();
  expect(Updates.instances[0].close).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:background-2');
});

it('persists transparency across panels and remounts without reading or rewriting image bytes', async () => {
  const first = renderHook(() => useWorkspaceBackground(vi.fn()));
  const second = renderHook(() => useWorkspaceBackground(vi.fn()));
  await act(async () => undefined);
  store.read.mockClear();
  act(() => { first.result.current.setTransparency(32); });
  expect(first.result.current.transparency).toBe(32);
  expect(second.result.current.transparency).toBe(32);
  expect(store.read).not.toHaveBeenCalled();
  expect(store.write).not.toHaveBeenCalled();
  first.unmount();
  second.unmount();
  const restored = renderHook(() => useWorkspaceBackground(vi.fn()));
  expect(restored.result.current.transparency).toBe(32);
});

it('syncs transparency from other windows, bounds saved values and keeps the prior value when saving fails', () => {
  const key = 'setsuna.workspace-background-transparency';
  window.localStorage.setItem(key, 'invalid');
  const onError = vi.fn();
  const { result } = renderHook(() => useWorkspaceBackground(onError));
  expect(result.current.transparency).toBe(70);
  act(() => {
    window.localStorage.setItem(key, '150');
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  expect(result.current.transparency).toBe(100);
  act(() => { result.current.setTransparency(-10); });
  expect(result.current.transparency).toBe(0);
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  act(() => { result.current.setTransparency(40); });
  expect(result.current.transparency).toBe(0);
  expect(onError).toHaveBeenCalledExactlyOnceWith('save');
});
