import { randomUUID } from 'node:crypto';
import { BrowserWindow, dialog, nativeTheme } from 'electron';
import { runtimeText, type RuntimeInterfaceLanguage, type SandboxDialogRequest, type SandboxDialogResult } from '@setsuna-desktop/contracts';
import { sandboxPromptPage } from './sandbox-dialog-page.js';

export async function showSandboxDialog(
  owner: BrowserWindow, input: SandboxDialogRequest,
  options: { title: string; language: RuntimeInterfaceLanguage; signal: AbortSignal },
): Promise<SandboxDialogResult> {
  options.signal.throwIfAborted();
  const t = runtimeText(options.language);
  if (input.kind === 'prompt') return showPrompt(owner, input, options);
  const result = await dialog.showMessageBox(owner, {
    title: options.title, message: input.message, type: 'none', noLink: true,
    buttons: input.kind === 'confirm' ? [t('OK', '确定'), t('Cancel', '取消')] : [t('OK', '确定')],
    defaultId: 0, cancelId: input.kind === 'confirm' ? 1 : 0, signal: options.signal,
  });
  return input.kind === 'confirm' ? !options.signal.aborted && result.response === 0 : null;
}

function showPrompt(
  owner: BrowserWindow, input: SandboxDialogRequest,
  options: { title: string; language: RuntimeInterfaceLanguage; signal: AbortSignal },
): Promise<string | null> {
  const t = runtimeText(options.language);
  const replyPrefix = `setsuna-dialog-result:${randomUUID()}:`;
  // A separate renderer is necessary: the calling iframe is waiting synchronously.
  const window = new BrowserWindow({
    parent: owner, modal: true, show: false, width: 440, height: 280, useContentSize: true,
    title: options.title, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: string | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', cancel);
      if (!window.isDestroyed()) window.destroy();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(null);
    window.once('closed', cancel);
    options.signal.addEventListener('abort', cancel, { once: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    // The private, script-only prompt has no preload or host APIs. Its single
    // response travels as a nonce-prefixed title event, not a navigation or IPC surface.
    window.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      if (!title.startsWith(replyPrefix)) return;
      try {
        const value: unknown = JSON.parse(decodeURIComponent(title.slice(replyPrefix.length)));
        if (value === null || typeof value === 'string') finish(value);
      } catch { /* Ignore intermediate/non-result document titles. */ }
    });
    window.once('ready-to-show', () => { if (!settled) { window.show(); window.focus(); } });
    const html = sandboxPromptPage({
      title: options.title, message: input.message, defaultValue: input.defaultValue ?? '',
      confirm: t('OK', '确定'), cancel: t('Cancel', '取消'), replyPrefix, dark: nativeTheme.shouldUseDarkColors,
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error: unknown) => finish(null, error));
    if (options.signal.aborted) cancel();
  });
}
