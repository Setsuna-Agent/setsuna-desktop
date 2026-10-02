import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ register: vi.fn((_key: string, _callback: () => void) => true), unregister: vi.fn() }));
vi.mock('electron', () => ({ globalShortcut: { register: mocks.register, unregister: mocks.unregister } }));
import { NativeComputerSupervisor } from '../../src/main/supervisor.js';
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('desktop emergency stop', () => {
  it('registers and releases an emergency stop without a window or foreground dependency', async () => {
    const supervisor = new NativeComputerSupervisor(); const stop = vi.fn();
    await supervisor.registerStop(stop);
    const callback = mocks.register.mock.calls[0]?.[1] as unknown as () => void;
    callback(); expect(stop).toHaveBeenCalledWith('emergency-shortcut');
    supervisor.unregisterStop();
    expect(mocks.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Escape');
  });
  it('reports a conflicting emergency shortcut before starting desktop input', async () => {
    mocks.register.mockReturnValueOnce(false);
    await expect(new NativeComputerSupervisor().registerStop(vi.fn())).rejects.toThrow('急停快捷键');
  });
});
