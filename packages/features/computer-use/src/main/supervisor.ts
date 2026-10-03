import { globalShortcut, powerMonitor, screen } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { computerStopShortcuts, type ComputerAction, type ComputerDisplay, type ComputerFrame, type ComputerTarget } from '../contracts/index.js';
import type { ComputerSupervisor } from './session-controller.js';
import { computerPermissions } from './permissions.js';
import { ComputerControlIndicator } from './control-indicator.js';

/** System prerequisites and an emergency stop, independent of application focus. */
export class NativeComputerSupervisor implements ComputerSupervisor {
  private readonly stopShortcut = computerStopShortcuts[process.platform === 'darwin' ? 'darwin' : 'win32'];
  private stop: ((reason?: string) => void) | undefined;
  private readonly indicator: ComputerControlIndicator;
  constructor(language: () => RuntimeInterfaceLanguage = () => 'zh-CN') {
    this.indicator = new ComputerControlIndicator(language, (reason) => this.stop?.(reason));
  }
  display(): ComputerDisplay {
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
    if (!globalShortcut.register(this.stopShortcut.accelerator, () => stop('emergency-shortcut'))) {
      throw new Error(`无法注册桌面急停快捷键（${this.stopShortcut.label}），可能已被其他应用占用。请释放该快捷键后重试。`);
    }
    this.stop = stop;
  }
  async showControl(target: ComputerTarget, signal: AbortSignal): Promise<void> {
    if (!this.stop) throw new Error('Emergency stop must be ready before showing computer control.');
    await this.indicator.show(target, signal);
  }
  prepareInput(action: ComputerAction, frame: ComputerFrame): void {
    this.indicator.prepareInput(action, frame);
  }
  unregisterStop(): void {
    this.stop = undefined;
    this.indicator.hide();
    globalShortcut.unregister(this.stopShortcut.accelerator);
  }
}
