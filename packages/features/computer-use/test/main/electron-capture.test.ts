import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComputerDisplay } from '../../src/contracts/index.js';
const mocks = vi.hoisted(() => ({ getSources: vi.fn() }));
vi.mock('electron', () => ({ desktopCapturer: { getSources: mocks.getSources } }));
import { assessCapture, ElectronComputerCapture } from '../../src/main/electron-capture.js';
const display: ComputerDisplay = { id: 42, bounds: { x: 0, y: 0, width: 1000, height: 500 }, scaleFactor: 2, inputBounds: { x: 0, y: 0, width: 1000, height: 500 }, inputCoordinateSpace: 'macos-points' };
function pixels() {
  const data = Buffer.alloc(64 * 64 * 4);
  for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
  return data;
}
function source(id = '42', width = 800, height = 400) {
  const data = pixels(); data.fill(200, (32 * 64 + 32) * 4, (32 * 64 + 33) * 4); data[(32 * 64 + 32) * 4 + 3] = 255;
  return { display_id: id, id: 'screen:0:0', name: 'Not an identity', thumbnail: {
    isEmpty: () => false, getSize: () => ({ width, height }), resize: () => ({ toBitmap: () => data }),
    toPNG: () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  } };
}
afterEach(() => vi.clearAllMocks());
describe('authorized Electron memory capture', () => {
  it('binds actual thumbnail dimensions to the exact OS display and encodes PNG in memory', async () => {
    mocks.getSources.mockResolvedValue([source('43', 1024, 768), source()]);
    const frame = await new ElectronComputerCapture().capture(display, new AbortController().signal);
    expect(frame).toMatchObject({ width: 800, height: 400, capture: { sourceDisplayId: '42', backend: 'electron-desktop-capturer' } });
    expect(mocks.getSources).toHaveBeenCalledWith({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 1920, height: 960 } });
    expect(frame.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
  it('bounds high-resolution images even when Electron ignores the requested size, preserving physical geometry', async () => {
    const physicalDisplay: ComputerDisplay = { id: 42, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5,
      inputBounds: { x: 0, y: 0, width: 3840, height: 2160 }, inputCoordinateSpace: 'windows-physical-pixels' };
    const bounded = source('42', 1920, 1080).thumbnail;
    const resize = vi.fn(() => bounded);
    mocks.getSources.mockResolvedValue([{ ...source('42', 3840, 2160), thumbnail: { ...source('42', 3840, 2160).thumbnail, resize } }]);
    const frame = await new ElectronComputerCapture().capture(physicalDisplay, new AbortController().signal);
    expect(mocks.getSources).toHaveBeenCalledWith({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 1920, height: 1080 } });
    expect(resize).toHaveBeenCalledExactlyOnceWith({ width: 1920, height: 1080, quality: 'best' });
    expect(frame).toMatchObject({ width: 1920, height: 1080 });
    expect(physicalDisplay.inputBounds).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
  });
  it.each([[], [source('')], [source('43')], [source(), source()], [source('42', 800, 700)]].map((sources) => ({ sources })))('rejects unknown, ambiguous or distorted display sources', async ({ sources }) => {
    mocks.getSources.mockResolvedValue(sources);
    await expect(new ElectronComputerCapture().capture(display, new AbortController().signal)).rejects.toThrow(/display|ratio/);
  });
  it('never requests a frame after cancellation and ignores a late in-flight capture', async () => {
    const capture = new ElectronComputerCapture();
    await expect(capture.capture(display, AbortSignal.abort())).rejects.toThrow();
    expect(mocks.getSources).not.toHaveBeenCalled();
    let finish!: (value: unknown[]) => void;
    mocks.getSources.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const abort = new AbortController(); const pending = capture.capture(display, abort.signal);
    const rejected = expect(pending).rejects.toThrow('cancel'); await vi.waitFor(() => expect(finish).toBeTypeOf('function')); abort.abort(new Error('cancel')); await rejected;
    await expect(capture.capture(display, new AbortController().signal)).rejects.toThrow('still completing');
    finish([source()]); await Promise.resolve();
  });
  it('rejects empty captures and invalid encoded bytes', async () => {
    const empty = source(); empty.thumbnail.isEmpty = () => true; mocks.getSources.mockResolvedValue([empty]);
    await expect(new ElectronComputerCapture().capture(display, new AbortController().signal)).rejects.toThrow('decoded');
    const corrupt = source(); corrupt.thumbnail.toPNG = () => Buffer.from('broken'); mocks.getSources.mockResolvedValue([corrupt]);
    await expect(new ElectronComputerCapture().capture(display, new AbortController().signal)).rejects.toThrow('encoding');
  });
  it('preserves native string failures and releases the capture slot for the next session', async () => {
    const capture = new ElectronComputerCapture();
    mocks.getSources.mockRejectedValueOnce('Failed to get sources.').mockResolvedValueOnce([source()]);
    await expect(capture.capture(display, new AbortController().signal)).rejects.toThrow('Desktop capture failed: Failed to get sources.');
    await expect(capture.capture(display, new AbortController().signal)).resolves.toMatchObject({ width: 800 });
  });
});
describe('capture quality diagnostics', () => {
  it('reports dark, uniform and transparent pixels without rejecting legitimate page content', () => {
    const data = pixels();
    expect(assessCapture(data, 64, 64)).toMatchObject({ nearBlackFraction: 1, contrast: 0 });
    expect(assessCapture(Buffer.alloc(64 * 64 * 4), 64, 64).transparentFraction).toBe(1);
    data.fill(255, 0, 64 * 4);
    expect(assessCapture(data, 64, 64)).toMatchObject({ contrast: 255, interiorContrast: 0 });
    expect(() => assessCapture(Buffer.alloc(1), 64, 64)).toThrow('Invalid');
  });
});
