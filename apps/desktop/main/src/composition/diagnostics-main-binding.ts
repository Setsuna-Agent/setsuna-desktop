import { app, type BrowserWindow, type RenderProcessGoneDetails, type WebContents } from 'electron';
import { release } from 'node:os';
import { DesktopDiagnosticLog } from '@setsuna-desktop/feature-diagnostics/main';

/** Bind before any window loads, including the gap before desktop services are ready. */
export function registerDesktopDiagnostics(directory: string): DesktopDiagnosticLog {
  const log = new DesktopDiagnosticLog(directory, {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    v8Version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osVersion: release(),
  });
  const gone = (_event: unknown, contents: WebContents, details: RenderProcessGoneDetails) => {
    log.record('renderer-process-gone', {
      senderId: contents.id,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  };
  const observeWindow = (_event: unknown, window: BrowserWindow) => {
    const senderId = window.webContents.id;
    const unresponsive = () => log.record('window-unresponsive', { senderId });
    window.on('unresponsive', unresponsive);
    window.once('closed', () => window.removeListener('unresponsive', unresponsive));
  };
  app.on('render-process-gone', gone);
  const childGone = (_event: unknown, details: { type: string; reason: string; exitCode: number }) => {
    log.record('native-child-process-gone', {
      processType: details.type, reason: details.reason, exitCode: details.exitCode,
    });
  };
  app.on('child-process-gone', childGone);
  app.on('browser-window-created', observeWindow);
  app.once('will-quit', () => {
    app.removeListener('render-process-gone', gone);
    app.removeListener('child-process-gone', childGone);
    app.removeListener('browser-window-created', observeWindow);
  });
  return log;
}
