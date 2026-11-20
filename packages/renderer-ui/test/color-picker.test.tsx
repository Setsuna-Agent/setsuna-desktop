// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ColorPicker, type PickerColor } from '../src/color-picker/color-picker.js';
import { UiProvider } from '../src/locale.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('commits only the released color of a completed drag', async () => {
  const commit = vi.fn<(color: string) => Promise<boolean>>().mockResolvedValue(true);
  render(<UiProvider locale="en-US">
    <ColorPicker label="Fill" value="#ff0000" onValueCommit={commit} />
  </UiProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
  const colorArea = await screen.findByRole('slider', { name: 'Saturation and brightness' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 100));

  const start = { pointerId: 1, button: 0, clientX: 60, clientY: 30 };
  const move = { ...start, clientX: 100, clientY: 65 };
  const release = { ...start, clientX: 220, clientY: 80 };
  fireEvent.pointerDown(colorArea, start);
  fireEvent.pointerMove(colorArea, move);
  fireEvent.pointerCancel(colorArea, move);
  fireEvent.pointerUp(colorArea, release);
  expect(commit).not.toHaveBeenCalled();

  fireEvent.pointerDown(colorArea, start);
  fireEvent.pointerMove(colorArea, move);
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerUp(colorArea, release); });
  fireEvent.pointerUp(colorArea, release);
  expect(commit).toHaveBeenCalledExactlyOnceWith('#800000');
});

it('previews opacity independently of color and clears it on cancellation', async () => {
  const preview = vi.fn<(paint: PickerColor | undefined) => void>();
  const commit = vi.fn<(paint: PickerColor) => Promise<boolean>>().mockResolvedValue(true);
  render(<UiProvider locale="en-US">
    <ColorPicker label="Fill" value="#2b4a6d" opacity={0.4} onColorPreview={preview} onColorCommit={commit} />
  </UiProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
  const alpha = await screen.findByRole('slider', { name: 'Opacity' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 100));
  const start = { pointerId: 1, button: 0, clientX: 60, clientY: 50 };
  const end = { ...start, clientX: 180 };
  fireEvent.pointerDown(alpha, start);
  fireEvent.pointerMove(alpha, end);
  expect(preview).toHaveBeenLastCalledWith({ color: '#2b4a6d', opacity: 0.8 });
  fireEvent.pointerCancel(alpha, end);
  expect(preview).toHaveBeenLastCalledWith(undefined);
  expect(commit).not.toHaveBeenCalled();

  fireEvent.pointerDown(alpha, start);
  await act(async () => { fireEvent.pointerUp(alpha, end); });
  expect(commit).toHaveBeenCalledExactlyOnceWith({ color: '#2b4a6d', opacity: 0.8 });
});

it('previews a typed HEX value without losing the original alpha when the suffix is removed', async () => {
  const preview = vi.fn<(paint: PickerColor | undefined) => void>();
  const commit = vi.fn<(paint: PickerColor) => Promise<boolean>>().mockResolvedValue(true);
  render(<UiProvider locale="en-US">
    <ColorPicker label="Fill" value="#2b4a6d" opacity={0.4} onColorPreview={preview} onColorCommit={commit} />
  </UiProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
  const hex = await screen.findByRole('textbox', { name: 'HEX' });
  hex.focus();
  fireEvent.change(hex, { target: { value: '44AA6680' } });
  expect(preview).toHaveBeenLastCalledWith({ color: '#44aa66', opacity: 128 / 255 });
  fireEvent.change(hex, { target: { value: '44AA66' } });
  expect(preview).toHaveBeenLastCalledWith({ color: '#44aa66', opacity: 0.4 });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(hex, { key: 'Escape' });
  expect(preview).toHaveBeenLastCalledWith(undefined);
  expect(commit).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
  const reopened = await screen.findByRole('textbox', { name: 'HEX' });
  reopened.focus();
  fireEvent.change(reopened, { target: { value: '44AA66' } });
  await act(async () => { fireEvent.keyDown(reopened, { key: 'Enter' }); });
  expect(commit).toHaveBeenCalledExactlyOnceWith({ color: '#44aa66', opacity: 0.4 });
});
