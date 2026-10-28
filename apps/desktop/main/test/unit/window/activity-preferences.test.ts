import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_ACTIVITY_PREFERENCES } from '@setsuna-desktop/contracts';
import { DesktopActivityPreferencesController } from '../../../src/window/activity-preferences.js';

const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: io.read }));
vi.mock('../../../src/data-root/atomic-json.js', () => ({ writeJsonAtomically: io.write }));
beforeEach(() => { vi.clearAllMocks(); io.read.mockResolvedValue(JSON.stringify(DEFAULT_DESKTOP_ACTIVITY_PREFERENCES)); io.write.mockResolvedValue(undefined); });
function setup() {
  const power = { start: vi.fn(() => 7), stop: vi.fn() };
  const shortcuts = { register: vi.fn(() => true), unregister: vi.fn() };
  const controller = new DesktopActivityPreferencesController({ filePath: '/preferences.json', power, shortcuts, onSummon: vi.fn() });
  return { controller, power, shortcuts };
}
it('holds one blocker for concurrent tasks and releases when disabled, idle or disposed', async () => {
  const { controller, power } = setup();
  controller.setActiveTurns(2);
  expect(io.read).not.toHaveBeenCalled(); // Activity itself adds no initialization dependency.
  expect(power.start).not.toHaveBeenCalled();
  await controller.set({ keepAwakeDuringTasks: true, summonShortcut: 'disabled' });
  controller.setActiveTurns(1);
  expect(power.start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension');
  controller.setActiveTurns(0);
  expect(power.stop).toHaveBeenCalledExactlyOnceWith(7);
  controller.setActiveTurns(1);
  await controller.set(DEFAULT_DESKTOP_ACTIVITY_PREFERENCES);
  expect(power.stop).toHaveBeenCalledTimes(2);
  await controller.set({ keepAwakeDuringTasks: true, summonShortcut: 'disabled' });
  controller.dispose(); controller.setActiveTurns(2);
  expect(power.start).toHaveBeenCalledTimes(3);
  expect(power.stop).toHaveBeenCalledTimes(3);
});
it('never registers a shortcut or blocker after a delayed restore outlives the desktop', async () => {
  let resolve!: (text: string) => void;
  io.read.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  const { controller, power, shortcuts } = setup();
  const pending = controller.initialize();
  controller.setActiveTurns(1); controller.dispose();
  resolve(JSON.stringify({ keepAwakeDuringTasks: true, summonShortcut: 'Alt+Space' }));
  await pending;
  expect(power.start).not.toHaveBeenCalled(); expect(shortcuts.register).not.toHaveBeenCalled();
});
it('keeps the current shortcut when registration conflicts or saving fails', async () => {
  const { controller, shortcuts } = setup();
  await controller.set({ keepAwakeDuringTasks: false, summonShortcut: 'Alt+Space' });
  shortcuts.register.mockReturnValueOnce(false);
  await expect(controller.set({ keepAwakeDuringTasks: true, summonShortcut: 'CommandOrControl+Shift+Space' })).rejects.toThrow('already in use');
  expect(shortcuts.unregister).not.toHaveBeenCalled();
  io.write.mockRejectedValueOnce(new Error('Disk full'));
  await expect(controller.set({ keepAwakeDuringTasks: true, summonShortcut: 'CommandOrControl+Shift+Space' })).rejects.toThrow('Disk full');
  expect(shortcuts.unregister).toHaveBeenCalledExactlyOnceWith('CommandOrControl+Shift+Space');
  expect(await controller.get()).toEqual({ keepAwakeDuringTasks: false, summonShortcut: 'Alt+Space' });
});

it('releases a newly registered shortcut immediately when disposal races an unfinished save', async () => {
  const { controller, shortcuts } = setup();
  await controller.initialize();
  let finish!: () => void;
  io.write.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const pending = controller.set({ keepAwakeDuringTasks: true, summonShortcut: 'Alt+Space' });
  await vi.waitFor(() => expect(shortcuts.register).toHaveBeenCalled());
  controller.dispose();
  expect(shortcuts.unregister).toHaveBeenCalledWith('Alt+Space');
  finish();
  await expect(pending).rejects.toThrow('stopped');
});
