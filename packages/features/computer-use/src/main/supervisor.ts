import { globalShortcut, powerMonitor, screen } from 'electron';
import type { ComputerDisplay } from '../contracts/index.js';
import type { ComputerSupervisor } from './session-controller.js';
import { computerPermissions } from './permissions.js';

const stopShortcut = 'CommandOrControl+Shift+Escape';

/** System prerequisites and an emergency stop, independent of application focus. */
export class NativeComputerSupervisor implements ComputerSupervisor {
  display(): ComputerDisplay {
    if (screen.getAllDisplays().length !== 1) throw new Error('Supervised desktop control currently requires exactly one display.');
    const display = screen.getPrimaryDisplay();
    const inputBounds = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : { ...display.bounds };
    if (inputBounds.x !== 0 || inputBounds.y !== 0) throw new Error('Desktop control requires the primary display origin.');
    return { id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor, inputBounds, inputCoordinateSpace: process.platform === 'win32' ? 'windows-physical-pixels' : 'macos-points' };
  }
  checkPermissions(): void {
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Desktop control supports macOS and Windows only.');
    if (powerMonitor.getSystemIdleState(1) === 'locked') throw new Error('Desktop is locked; session stopped.');
    if (process.platform === 'darwin' && Number(process.getSystemVersion().split('.')[0]) < 14) throw new Error('后台窗口控制需要 macOS 14 或更新版本。');
    const permissions = computerPermissions();
    if (process.platform === 'darwin' && (permissions.screen !== 'granted' || permissions.accessibility !== 'granted')) {
      throw new Error('请在「设置 → 电脑控制」点击未授权权限旁的「去授权」，按系统提示开启权限；若系统要求重启，请完整退出并重新打开应用。');
    }
  }
  async registerStop(stop: (reason?: string) => void): Promise<void> {
    if (!globalShortcut.register(stopShortcut, () => stop('emergency-shortcut'))) {
      throw new Error('无法注册桌面急停快捷键。');
    }
  }
  unregisterStop(): void {
    globalShortcut.unregister(stopShortcut);
  }
}
