import type { BrowserWindow, NativeImage, WebContentsView } from 'electron';
import { createStartupSplashPageUrl } from './startup-splash-page.js';

const rendererFirstPaintTimeoutMs = 750;

export interface StartupSplashLayer {
  dispose(): void;
}

export interface StartupSplashOptions {
  maximized?: boolean;
}

export async function showStartupSplash(
  window: BrowserWindow,
  view: WebContentsView,
  icon?: NativeImage,
  options: StartupSplashOptions = {},
): Promise<StartupSplashLayer> {
  let disposed = false;
  const updateBounds = () => {
    if (window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.off('resize', updateBounds);
    window.off('closed', dispose);
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  };

  view.setBackgroundColor('#f7f6fa');
  updateBounds();
  window.contentView.addChildView(view);
  window.on('resize', updateBounds);
  window.once('closed', dispose);

  try {
    // A small in-memory image keeps the splash independent of packaged asset paths.
    const logoDataUrl = icon?.resize({ width: 108, height: 108, quality: 'best' }).toDataURL();
    await view.webContents.loadURL(createStartupSplashPageUrl(logoDataUrl));
  } catch (error) {
    dispose();
    throw error;
  }

  if (window.isDestroyed()) {
    dispose();
    throw new Error('Desktop window was closed before the startup splash became ready.');
  }
  // Maximizing a hidden BrowserWindow does not make it visible on Windows.
  // Restore the state first so showing it never flashes at the normal bounds.
  if (options.maximized) window.maximize();
  window.show();
  return { dispose };
}

export async function waitForRendererFirstPaint(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;

  // loadURL/loadFile resolves at page load, but React can commit its first frame just after that.
  // Keep the splash view above the renderer until a populated root has crossed two paint frames.
  const rendererPaint = window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let settled = false;
      let observer;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      const root = document.getElementById('root');
      if (root?.childElementCount) {
        finish();
        return;
      }
      if (root) {
        observer = new MutationObserver(() => {
          if (root.childElementCount) finish();
        });
        observer.observe(root, { childList: true });
      }
      setTimeout(finish, 500);
    });
  `);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, rendererFirstPaintTimeoutMs);
  });
  try {
    await Promise.race([rendererPaint, timeout]);
  } catch {
    // If the renderer navigated during the probe, retain the splash for the fallback interval.
    await timeout;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
