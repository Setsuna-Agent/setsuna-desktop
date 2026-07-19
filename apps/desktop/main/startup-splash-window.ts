import type { BrowserWindow, NativeImage, WebContentsView } from 'electron';
import {
  createStartupSplashPageUrl,
  startupSplashWindowActionFromUrl,
} from './startup-splash-page.js';
import { toggleWindowMaximized } from './window-frame.js';

const rendererFirstPaintTimeoutMs = 5_000;
const splashTeardownDelayMs = 50;

export interface StartupSplashLayer {
  dispose(): void;
  reveal(): void;
}

export interface StartupSplashOptions {
  maximized?: boolean;
  windowControls?: boolean;
}

export async function showStartupSplash(
  window: BrowserWindow,
  view: WebContentsView,
  icon?: NativeImage,
  options: StartupSplashOptions = {},
): Promise<StartupSplashLayer> {
  let disposed = false;
  let teardownTimer: ReturnType<typeof setTimeout> | null = null;
  const updateBounds = () => {
    if (window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  const handleNavigation = (details: { preventDefault(): void; url: string }) => {
    const action = startupSplashWindowActionFromUrl(details.url);
    if (!action) return;
    details.preventDefault();
    if (window.isDestroyed()) return;
    if (action === 'minimize') window.minimize();
    else if (action === 'toggle-maximize') toggleWindowMaximized(window);
    else window.close();
  };
  const detachListeners = () => {
    window.off('resize', updateBounds);
    window.off('closed', dispose);
    if (options.windowControls) view.webContents.off('will-navigate', handleNavigation);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (teardownTimer) clearTimeout(teardownTimer);
    teardownTimer = null;
    detachListeners();
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  };
  const reveal = () => {
    if (disposed || teardownTimer) return;
    detachListeners();
    if (!view.webContents.isDestroyed()) view.setVisible(false);
    // Let Chromium present the already-painted renderer before destroying the old surface.
    teardownTimer = setTimeout(() => {
      teardownTimer = null;
      dispose();
    }, splashTeardownDelayMs);
  };

  view.setBackgroundColor('#f7f6fa');
  updateBounds();
  window.contentView.addChildView(view);
  window.on('resize', updateBounds);
  window.once('closed', dispose);
  if (options.windowControls) view.webContents.on('will-navigate', handleNavigation);

  try {
    // A small in-memory image keeps the splash independent of packaged asset paths.
    const logoDataUrl = icon?.resize({ width: 108, height: 108, quality: 'best' }).toDataURL();
    await view.webContents.loadURL(createStartupSplashPageUrl(logoDataUrl, {
      windowControls: options.windowControls,
    }));
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
  await restartStartupSplashAnimation(view);
  return { dispose, reveal };
}

async function restartStartupSplashAnimation(view: WebContentsView): Promise<void> {
  if (view.webContents.isDestroyed()) return;
  try {
    // The page loads while its native window is hidden. Restart after show() so the first
    // sweep is visible instead of spending its active frames on an off-screen surface.
    await view.webContents.executeJavaScript(`
      (() => {
        const root = document.documentElement;
        root.classList.remove('startup-splash-running');
        void root.offsetWidth;
        root.classList.add('startup-splash-running');
      })();
    `);
  } catch {
    // The initial CSS animation remains a safe fallback if the view closed during startup.
  }
}

export async function waitForRendererFirstPaint(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;

  // loadURL/loadFile resolves at page load, but React can commit its shell just after that.
  // Keep the splash above the renderer until the real shell has crossed two paint frames.
  const rendererPaint = window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let settled = false;
      let observer;
      let fallbackTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        observer?.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      const shell = document.querySelector('.app-shell');
      if (shell) {
        finish();
        return;
      }
      observer = new MutationObserver(() => {
        if (document.querySelector('.app-shell')) finish();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      fallbackTimer = setTimeout(finish, ${rendererFirstPaintTimeoutMs - 250});
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
