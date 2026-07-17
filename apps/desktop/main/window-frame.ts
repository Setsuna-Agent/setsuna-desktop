import type { BrowserWindow } from 'electron';

const windowsSystemCommand = 0x0112;
const windowsSystemCommandMask = 0xfff0;
const windowsMaximizeCommand = 0xf030;
const windowsRestoreCommand = 0xf120;
const windowsNonClientLeftButtonDoubleClick = 0x00a3;
const windowsCaptionHitTest = 2;

type MaximizableWindow = Pick<BrowserWindow, 'isMaximized' | 'maximize' | 'unmaximize'>;

export function registerWindowsTitlebarDoubleClick(window: BrowserWindow, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return;

  let pendingMaximizedState: boolean | null = null;
  let stateUpdateScheduled = false;
  const scheduleMaximizedState = (maximized: boolean) => {
    pendingMaximizedState = maximized;
    if (stateUpdateScheduled) return;
    stateUpdateScheduled = true;

    setImmediate(() => {
      stateUpdateScheduled = false;
      const nextMaximizedState = pendingMaximizedState;
      pendingMaximizedState = null;
      if (window.isDestroyed() || nextMaximizedState === null || window.isMaximized() === nextMaximizedState) return;
      if (nextMaximizedState) window.maximize();
      else window.unmaximize();
    });
  };

  window.hookWindowMessage(windowsSystemCommand, (wParam) => {
    const parameter = readWindowsMessageParameter(wParam);
    if (parameter === null) return;
    const command = parameter & windowsSystemCommandMask;
    if (command !== windowsMaximizeCommand && command !== windowsRestoreCommand) return;

    // 透明无边框窗口在标题栏的两种状态下都可能发出 SC_MAXIMIZE。
    // 将重复的最大化命令视为原生标题栏切换操作。
    scheduleMaximizedState(command === windowsMaximizeCommand ? !window.isMaximized() : false);
  });

  window.hookWindowMessage(windowsNonClientLeftButtonDoubleClick, (wParam) => {
    if (readWindowsMessageParameter(wParam) !== windowsCaptionHitTest || !window.isMaximized()) return;

    // 某些 Windows 与 Chromium 组合不会发出 SC_RESTORE，但仍会暴露标题栏双击。
    // 上面的合并处理可避免重复变更状态。
    scheduleMaximizedState(false);
  });
}

export function toggleWindowMaximized(window: MaximizableWindow): boolean {
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
  return window.isMaximized();
}

function readWindowsMessageParameter(parameter: Buffer): number | null {
  return parameter.length >= 4 ? parameter.readUInt32LE(0) : null;
}
