// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { PageSessionProvider, ToastProvider } from '@setsuna-desktop/renderer-ui';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePersonalizationPrompt } from '../../../../../src/features/settings/sections/usePersonalizationPrompt.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const wrapper = ({ children }: PropsWithChildren) => <ToastProvider><PageSessionProvider>{children}</PageSessionProvider></ToastProvider>;

it('does not replace newer typing with an older acknowledgement and flushes the last edit on leave', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const hook = renderHook(({ value }) => usePersonalizationPrompt(value, save), { initialProps: { value: 'Original' }, wrapper });
  act(() => hook.result.current.change('First edit'));
  await act(async () => vi.advanceTimersByTimeAsync(360));
  act(() => hook.result.current.change('Latest edit'));
  await act(async () => finish());
  hook.rerender({ value: 'First edit' });
  expect(hook.result.current.draft).toBe('Latest edit');
  hook.unmount();
  expect(save.mock.calls).toEqual([[{ globalPrompt: 'First edit' }], [{ globalPrompt: 'Latest edit' }]]);
});

it('saves a deliberate reversion even when a previous save is in flight', async () => {
  vi.useFakeTimers();
  const save = vi.fn(() => new Promise<void>(() => undefined));
  const hook = renderHook(() => usePersonalizationPrompt('Original', save), { wrapper });
  act(() => { hook.result.current.change('Changed'); hook.result.current.flush(); });
  act(() => { hook.result.current.change('Original'); hook.result.current.flush(); });
  expect(save.mock.calls).toEqual([[{ globalPrompt: 'Changed' }], [{ globalPrompt: 'Original' }]]);
});
