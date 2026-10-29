// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastStack } from '../src/toast/stack.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('pauses the remaining lifetime while hovered or keyboard focused', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  render(<ToastStack entries={[{ id: 1, message: 'Save failed', tone: 'error', durationMs: 5000 }]}
    label="Notifications" closeLabel="Close" onDismiss={dismiss} />);
  const notice = screen.getByRole('alert');
  act(() => vi.advanceTimersByTime(3000));
  fireEvent.mouseEnter(notice);
  act(() => vi.advanceTimersByTime(10000));
  fireEvent.mouseLeave(notice);
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.focus(screen.getByRole('button', { name: 'Close' }));
  act(() => vi.advanceTimersByTime(10000));
  fireEvent.blur(screen.getByRole('button', { name: 'Close' }));
  act(() => vi.advanceTimersByTime(999));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
});

it('keeps actionable failures until the user dismisses them or retries', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const retry = vi.fn();
  render(<ToastStack entries={[{ id: 1, message: 'Save failed', tone: 'error', durationMs: null, action: { label: 'Retry', onClick: retry } }]}
    label="Notifications" closeLabel="Close" onDismiss={dismiss} />);
  act(() => vi.advanceTimersByTime(60000));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(dismiss).toHaveBeenCalledWith(1);
});
