import { randomUUID } from 'node:crypto';
import { BrowserWindow, nativeTheme } from 'electron';
import { runtimeText, type RuntimeInterfaceLanguage, type SandboxDialogRequest, type SandboxDialogResult } from '@setsuna-desktop/contracts';
import { sandboxDialogPage } from './sandbox-dialog-page.js';

export function showSandboxDialog(
  owner: BrowserWindow, input: SandboxDialogRequest,
  options: { title: string; language: RuntimeInterfaceLanguage; signal: AbortSignal },
): Promise<SandboxDialogResult> {
  options.signal.throwIfAborted();
  const t = runtimeText(options.language);
  const replyPrefix = `setsuna-dialog-result:${randomUUID()}:`;
  const dark = input.theme ? input.theme.colorScheme === 'dark' : nativeTheme.shouldUseDarkColors;
  // A separate renderer is necessary: the calling iframe is waiting synchronously.
  const window = new BrowserWindow({
    parent: owner, modal: true, show: false, width: 440, height: 180, useContentSize: true, frame: false,
    title: options.title, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    backgroundColor: dark ? '#202020' : '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: SandboxDialogResult, error?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', cancel);
      if (!window.isDestroyed()) window.destroy();
      if (error) reject(error); else resolve(value);
    };
    const dismissedValue = input.kind === 'confirm' ? false : null;
    const cancel = () => finish(dismissedValue);
    window.once('closed', cancel);
    options.signal.addEventListener('abort', cancel, { once: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    // The private, script-only page has no preload or host APIs. Its single
    // response travels as a nonce-prefixed title event, not a navigation or IPC surface.
    window.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      if (!title.startsWith(replyPrefix)) return;
      try {
        const value: unknown = JSON.parse(decodeURIComponent(title.slice(replyPrefix.length)));
        if (input.kind === 'prompt' && (value === null || typeof value === 'string')
          || input.kind === 'confirm' && typeof value === 'boolean'
          || input.kind === 'alert' && value === null) finish(value as SandboxDialogResult);
      } catch { /* Ignore intermediate/non-result document titles. */ }
    });
    window.webContents.once('did-finish-load', () => {
      // Fit the private page before showing it; the host renderer is blocked by the caller's synchronous XHR.
      void window.webContents.executeJavaScript('Math.ceil(document.querySelector("form").getBoundingClientRect().height)').then((height: number) => {
        if (settled || window.isDestroyed()) return;
        window.setContentSize(440, height);
        window.show();
        window.focus();
      }).catch((error: unknown) => finish(dismissedValue, error));
    });
    const html = sandboxDialogPage({
      kind: input.kind, title: options.title, message: input.message, defaultValue: input.defaultValue ?? '',
      confirm: t('OK', '确定'), cancel: t('Cancel', '取消'), replyPrefix, dark, theme: input.theme,
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error: unknown) => finish(dismissedValue, error));
    if (options.signal.aborted) cancel();
  });
}
