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

    // Transparent frameless windows can emit SC_MAXIMIZE for both titlebar
    // states. Treat a repeated maximize command as the native titlebar toggle.
    scheduleMaximizedState(command === windowsMaximizeCommand ? !window.isMaximized() : false);
  });

  window.hookWindowMessage(windowsNonClientLeftButtonDoubleClick, (wParam) => {
    if (readWindowsMessageParameter(wParam) !== windowsCaptionHitTest || !window.isMaximized()) return;

    // Some Windows/Chromium combinations omit SC_RESTORE but still expose the
    // caption double-click. Coalescing above prevents duplicate state changes.
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
