import { afterEach, expect, it, vi } from 'vitest';
import { writeImageToClipboard } from '../../../src/workspace/image-clipboard.js';

function image(pixels: number[], empty = false) {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width: 1, height: 1 }),
    toBitmap: () => Buffer.from(pixels),
  };
}

afterEach(() => vi.useRealTimers());

it('completes one copy request after a silent native failure instead of accepting the previous image', async () => {
  vi.useFakeTimers();
  const target = image([255, 0, 0, 255]);
  let current = image([0, 0, 255, 255]);
  const clipboard = {
    writeImage: vi.fn((value: typeof target) => { current = value; }).mockImplementationOnce(() => undefined),
    readImage: () => current,
  };
  const copying = writeImageToClipboard(target, clipboard);
  expect(clipboard.writeImage).toHaveBeenCalledOnce();
  expect(current.toBitmap()).not.toEqual(target.toBitmap());
  await vi.advanceTimersByTimeAsync(50);
  await copying;
  expect(current.toBitmap()).toEqual(target.toBitmap());
  expect(clipboard.writeImage).toHaveBeenCalledTimes(2);
});

it('reports failure after bounded attempts when the clipboard never receives an image', async () => {
  vi.useFakeTimers();
  const target = image([255, 0, 0, 255]);
  const clipboard = { writeImage: vi.fn(), readImage: () => image([], true) };
  const failed = expect(writeImageToClipboard(target, clipboard)).rejects.toThrow('Failed to copy image.');
  await vi.runAllTimersAsync();
  await failed;
  expect(clipboard.writeImage).toHaveBeenCalledTimes(3);
});
