// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProcessResourceSnapshot, RuntimeActivityRendererService } from '../../src/contracts/index.js';
import { useResourceSnapshot } from '../../src/renderer/use-resource-snapshot.js';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture() {
  const snapshot: ProcessResourceSnapshot = { sampledAt: 0, processes: [] };
  const desktop = { sampleResources: vi.fn(async () => snapshot), terminateResourceProcess: vi.fn(async () => 'terminated' as const) };
  const runtime = { sampleResources: vi.fn(async () => snapshot) };
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const hook = renderHook(() => useResourceSnapshot(desktop, runtime as unknown as RuntimeActivityRendererService));
  return { ...hook, desktop, runtime, hide: (value: boolean) => act(() => {
    hidden = value; document.dispatchEvent(new Event('visibilitychange'));
  }) };
}

it('samples only while visible, cancels hidden requests and stops on unmount', async () => {
  vi.useFakeTimers();
  const { desktop, runtime, hide, unmount } = fixture();
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(desktop.sampleResources).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(runtime.sampleResources).toHaveBeenCalledTimes(2);
  hide(true);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(runtime.sampleResources).toHaveBeenCalledTimes(2);
  hide(false);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(runtime.sampleResources).toHaveBeenCalledTimes(3);
  unmount();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(desktop.sampleResources).toHaveBeenCalledTimes(3);
});

it('keeps the other source usable after one sampler hangs, then recovers on the next poll', async () => {
  vi.useFakeTimers();
  const { desktop, result } = fixture();
  desktop.sampleResources.mockImplementationOnce(() => new Promise(() => undefined));
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain('timed out');
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(desktop.sampleResources).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBeNull();
});
