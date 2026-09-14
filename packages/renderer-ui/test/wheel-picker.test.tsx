// @vitest-environment happy-dom

import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WheelPicker } from '../src/wheel-picker.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(itemHeight = 36) {
  const change = vi.fn();
  const view = render(<WheelPicker aria-label="Minute" defaultValue="10" itemHeight={itemHeight}
    options={Array.from({ length: 60 }, (_, index) => String(index))} onValueChange={change} />);
  const wheel = screen.getByRole('listbox', { name: 'Minute' });
  Object.assign(wheel, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  return { ...view, wheel, change };
}

function pointer(wheel: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', y: number, timeStamp: number) {
  const event = createEvent[type](wheel, { button: 0, pointerId: 1, clientY: y, bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(wheel, event);
}

it.each([
  { deltaMode: 0, deltaY: 100, itemHeight: 36, expected: '11' },
  { deltaMode: 1, deltaY: 1, itemHeight: 48, expected: '11' },
  { deltaMode: 2, deltaY: 1, itemHeight: 36, expected: '15' },
])('normalizes wheel input and commits before settling: $deltaMode', ({ deltaMode, deltaY, itemHeight, expected }) => {
  const { wheel, change } = setup(itemHeight);
  const event = createEvent.wheel(wheel, { deltaMode, deltaY, bubbles: true, cancelable: true });
  fireEvent(wheel, event);

  expect(event.defaultPrevented).toBe(true);
  expect(change).toHaveBeenCalledExactlyOnceWith(expected);
  act(() => vi.advanceTimersByTime(800));
  expect(change).toHaveBeenCalledTimes(1);
  expect(wheel.getAttribute('aria-valuetext')).toBe(expected);
});

it.each([false, true])('commits keyboard targets immediately with reduced motion %s', (reduced) => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { wheel, change, unmount } = setup();
  fireEvent.keyDown(wheel, { key: 'ArrowDown' });
  fireEvent.keyDown(wheel, { key: 'ArrowDown' });

  expect(change.mock.calls).toEqual([['11'], ['12']]);
  unmount();
  act(() => vi.advanceTimersByTime(800));
  expect(change).toHaveBeenCalledTimes(2);
});

it.each(['animation', 'wheel timer'] as const)('a corrective drag takes over from the previous %s', (source) => {
  const { wheel, change } = setup();
  if (source === 'animation') {
    fireEvent.keyDown(wheel, { key: 'End' });
    act(() => vi.advanceTimersByTime(64));
  } else {
    fireEvent.wheel(wheel, { deltaY: 60 });
  }
  pointer(wheel, 'pointerDown', 200, 1000);
  pointer(wheel, 'pointerMove', 180, 1100);
  const committedCount = change.mock.calls.length;

  act(() => vi.advanceTimersByTime(800));
  expect(change).toHaveBeenCalledTimes(committedCount);
});

it.each([
  { moveAt: 1001, releaseAt: 1002, cancel: false, expected: '14' },
  { moveAt: 1001, releaseAt: 3001, cancel: false, expected: '11' },
  { moveAt: 1001, releaseAt: 1002, cancel: true, expected: '11' },
  { moveAt: 1100, releaseAt: 1101, cancel: false, expected: '11' },
])('uses only fresh, uncancelled drag speed in rows/ms: $moveAt/$releaseAt/$cancel', ({ moveAt, releaseAt, cancel, expected }) => {
  const { wheel, change } = setup();
  pointer(wheel, 'pointerDown', 200, 1000);
  pointer(wheel, 'pointerMove', 110, moveAt);
  pointer(wheel, cancel ? 'pointerCancel' : 'pointerUp', 110, releaseAt);

  expect(change).toHaveBeenLastCalledWith(expected);
  act(() => vi.advanceTimersByTime(800));
  expect(wheel.getAttribute('aria-valuetext')).toBe(expected);
});
