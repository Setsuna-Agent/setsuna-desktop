import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  register: vi.fn((_key: string, _callback: () => void) => true), unregister: vi.fn(),
  getAllDisplays: vi.fn(), getPrimaryDisplay: vi.fn(), dipToScreenRect: vi.fn(),
}));
vi.mock('electron', () => ({
  globalShortcut: { register: mocks.register, unregister: mocks.unregister },
  screen: { getAllDisplays: mocks.getAllDisplays, getPrimaryDisplay: mocks.getPrimaryDisplay, dipToScreenRect: mocks.dipToScreenRect },
}));
import { NativeComputerSupervisor } from '../../src/main/supervisor.js';
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('desktop emergency stop', () => {
  it.each([
    ['win32', 'Control+Alt+Shift+Escape'],
    ['darwin', 'Command+Shift+Escape'],
  ] as const)('registers and releases the %s emergency stop without a window or foreground dependency', async (platform, accelerator) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const supervisor = new NativeComputerSupervisor(); const stop = vi.fn();
    await supervisor.registerStop(stop);
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(accelerator, expect.any(Function));
    const callback = mocks.register.mock.calls[0]?.[1] as unknown as () => void;
    callback(); expect(stop).toHaveBeenCalledWith('emergency-shortcut');
    supervisor.unregisterStop();
    expect(mocks.unregister).toHaveBeenCalledWith(accelerator);
  });
  it('reports a conflicting emergency shortcut before starting desktop input', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    mocks.register.mockReturnValueOnce(false);
    await expect(new NativeComputerSupervisor().registerStop(vi.fn())).rejects.toThrow('Ctrl + Alt + Shift + Esc');
  });
});

describe('Windows primary desktop', () => {
  it('keeps the primary display identity and physical bounds when a secondary display is attached', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const primary = { id: 42, bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 2 };
    mocks.getAllDisplays.mockReturnValue([{ ...primary, id: 43, bounds: { ...primary.bounds, x: -1280 } }, primary]);
    mocks.getPrimaryDisplay.mockReturnValue(primary);
    mocks.dipToScreenRect.mockReturnValue({ x: 0, y: 0, width: 2560, height: 1440 });
    expect(new NativeComputerSupervisor().display()).toEqual({
      ...primary, inputBounds: { x: 0, y: 0, width: 2560, height: 1440 }, inputCoordinateSpace: 'windows-physical-pixels',
    });
  });
});
