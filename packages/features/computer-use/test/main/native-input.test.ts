import { describe, expect, it, vi } from 'vitest';
import { dispatchNativeInput, type InputFrame, type NativeInputApi } from '../../src/main/native-input.js';
import { InputAdmission } from '../../src/main/input-admission.js';
function fixture() {
  const bounds = { x: 0, y: 0, width: 2000, height: 1000 };
  const frame: InputFrame = { width: 800, height: 400, display: { id: 42, bounds: { x: 0, y: 0, width: 1000, height: 500 }, scaleFactor: 2, inputBounds: { ...bounds }, inputCoordinateSpace: 'windows-physical-pixels' } };
  const native = { getDisplaySize: vi.fn(() => ({ ...bounds, pixelWidth: 2000, pixelHeight: 1000, scaleFactor: 2, displayId: 42 })), listDisplays: vi.fn(() => [{}]), mouseClick: vi.fn(), mouseMove: vi.fn(), mouseScroll: vi.fn(), keyPress: vi.fn(), typeText: vi.fn() } as unknown as NativeInputApi;
  return { native, frame, admission: new InputAdmission() };
}
describe('native input without implicit screenshots', () => {
  it('dispatches complete Windows modifier chords and releases them through one native keyPress', async () => {
    const f = fixture();
    await dispatchNativeInput(f.native, { kind: 'key', key: 'n', modifiers: ['Control', 'Shift'] }, f.frame, f.admission, 'win32');
    expect(f.native.keyPress).toHaveBeenCalledExactlyOnceWith('ctrl+shift+n', 1);
    expect(f.native.typeText).not.toHaveBeenCalled();
  });
  it('never routes macOS input through the global native adapter', async () => {
    const f = fixture();
    await expect(dispatchNativeInput(f.native, { kind: 'click', x: 0, y: 0 }, f.frame, f.admission, 'darwin')).rejects.toThrow('Windows only');
    expect(f.native.mouseClick).not.toHaveBeenCalled();
    expect(f.native.getDisplaySize).not.toHaveBeenCalled();
  });
  it('maps resized screenshot pixels into Windows physical pixels exactly once', async () => {
    const f = fixture();
    await dispatchNativeInput(f.native, { kind: 'click', x: 400, y: 200 }, f.frame, f.admission, 'win32');
    expect(f.native.mouseClick).toHaveBeenCalledWith(1000, 500, 'left', 1);
  });
  it('normalizes Windows scroll direction', async () => {
    const f = fixture();
    await dispatchNativeInput(f.native, { kind: 'scroll', x: 0, y: 0, direction: 'up', amount: 2 }, f.frame, f.admission, 'win32');
    expect(f.native.mouseScroll).toHaveBeenCalledTimes(2);
    expect(f.native.mouseScroll).toHaveBeenCalledWith(-1, 0);
  });
  it('rejects geometry/identity changes and out-of-image coordinates before input', async () => {
    for (const mutation of ['size', 'bounds', 'space']) {
      const f = fixture();
      if (mutation === 'size') f.frame.display.inputBounds.width = 1500;
      if (mutation === 'space') f.frame.display.inputCoordinateSpace = 'macos-points';
      await expect(dispatchNativeInput(f.native, { kind: 'click', x: mutation === 'bounds' ? 800 : 0, y: 0 }, f.frame, f.admission, 'win32')).rejects.toThrow();
      expect(f.native.mouseClick).not.toHaveBeenCalled();
    }
  });
  it('stops between complete Unicode codepoints without splitting a surrogate pair', async () => {
    const f = fixture();
    vi.mocked(f.native.typeText).mockImplementation((value) => { if (value === '🙂') f.admission.close(); });
    await expect(dispatchNativeInput(f.native, { kind: 'type', text: '中🙂后' }, f.frame, f.admission, 'win32')).rejects.toThrow('cancelled');
    expect(vi.mocked(f.native.typeText).mock.calls).toEqual([['中'], ['🙂']]);
  });
  it('rejects stopped admission and arbitrary modifier strings before native dispatch', async () => {
    const f = fixture();
    await expect(dispatchNativeInput(f.native, { kind: 'key', key: 'Meta+R' }, f.frame, f.admission, 'win32')).rejects.toThrow('Unsupported');
    f.admission.close();
    await expect(dispatchNativeInput(f.native, { kind: 'key', key: 'Tab' }, f.frame, f.admission, 'win32')).rejects.toThrow('cancelled');
    expect(f.native.keyPress).not.toHaveBeenCalled();
  });
});
