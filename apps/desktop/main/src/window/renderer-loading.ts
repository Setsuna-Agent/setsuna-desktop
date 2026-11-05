import { ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { DiagnosticReporter } from '@setsuna-desktop/contracts';
import { diagnosticErrorFields, reportDiagnostic } from '../diagnostics/report.js';
import { registerRendererImagePolicy } from './renderer-image-policy.js';
import { registerDesktopRendererRecovery } from './renderer-recovery.js';

type RendererLoadOptions = {
  appRoot: string;
  devServerUrl?: string;
  prepare?: () => Promise<void>;
  canRecover?: () => boolean;
  onDiagnostic?: DiagnosticReporter;
};

const readinessBySender = new Map<number, () => Promise<void>>();

/** Load Chromium resources alongside services, then allow renderer business initialization. */
export async function loadDesktopRenderer(window: BrowserWindow, options: RendererLoadOptions): Promise<void> {
  const startedAt = performance.now();
  const senderId = window.webContents.id;
  reportDiagnostic(options.onDiagnostic, 'renderer-load-started', { senderId });
  registerRendererImagePolicy(window, path.join(options.appRoot, 'dist/renderer'));
  const assertAvailable = () => {
    if (window.isDestroyed()) throw new Error('Desktop window closed during startup.');
  };
  const ready = Promise.resolve().then(async () => {
    assertAvailable();
    await options.prepare?.();
    reportDiagnostic(options.onDiagnostic, 'desktop-services-ready', { senderId, elapsedMs: Math.round(performance.now() - startedAt) });
  }).catch((error: unknown) => {
    reportDiagnostic(options.onDiagnostic, 'desktop-services-failed', { senderId, ...diagnosticErrorFields(error) });
    throw error;
  });

  readinessBySender.set(senderId, async () => {
    await ready;
    assertAvailable();
  });
  ipcMain.removeHandler('desktop:when-ready');
  ipcMain.handle('desktop:when-ready', async (event) => {
    const whenReady = readinessBySender.get(event.sender.id);
    if (!whenReady) throw new Error('Desktop renderer is unavailable.');
    await whenReady();
  });
  // Keep the handler after handoff so a renderer reload observes the same settled readiness.
  window.once('closed', () => {
    readinessBySender.delete(senderId);
    if (!readinessBySender.size) ipcMain.removeHandler('desktop:when-ready');
  });

  const load = () => {
    assertAvailable();
    return options.devServerUrl
      ? window.loadURL(options.devServerUrl)
      : window.loadFile(path.join(options.appRoot, 'dist/renderer/index.html'));
  };
  const loaded = Promise.resolve().then(load).then(() => {
    reportDiagnostic(options.onDiagnostic, 'renderer-document-loaded', { senderId, elapsedMs: Math.round(performance.now() - startedAt) });
  }).catch((error: unknown) => {
    reportDiagnostic(options.onDiagnostic, 'renderer-load-failed', { senderId, ...diagnosticErrorFields(error) });
    throw error;
  });
  // Observe both failures immediately, including a page load that fails before services finish.
  await Promise.all([ready, loaded]);
  assertAvailable();
  // Reuse settled readiness and the same session slot; do not prepare services again.
  registerDesktopRendererRecovery(window, { load, canRecover: options.canRecover ?? (() => true), onDiagnostic: options.onDiagnostic });
}
