import { BrowserWindow, session } from 'electron';

const IMAGE_WIDTH = 1000;
const MAX_IMAGE_HEIGHT = 32_000;
const RENDER_TIMEOUT_MS = 30_000;

/** Render only on export, in an unprivileged window that never becomes visible. */
export async function renderConversationImage(html: string): Promise<Buffer> {
  const exportSession = session.fromPartition('conversation-export', { cache: false });
  exportSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  exportSession.setPermissionCheckHandler(() => false);
  exportSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = (details.resourceType === 'mainFrame' && details.url.startsWith('data:text/html;'))
      || (details.resourceType === 'image' && /^(https?:|data:)/u.test(details.url));
    callback({ cancel: !allowed });
  });
  const window = new BrowserWindow({
    show: false,
    width: IMAGE_WIDTH,
    height: 800,
    webPreferences: {
      session: exportSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      javascript: false, webviewTag: false, offscreen: true, backgroundThrottling: false,
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      capture(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Conversation image export timed out.')), RENDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (!window.isDestroyed()) window.destroy();
  }

  async function capture(): Promise<Buffer> {
    await window.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
    // The offscreen renderer must have a loaded document before device emulation.
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      // Let the document determine image height, even for a single short reply.
      width: IMAGE_WIDTH, height: 1, deviceScaleFactor: 1, mobile: false,
    });
    const { cssContentSize } = await contents.debugger.sendCommand('Page.getLayoutMetrics') as {
      cssContentSize: { width: number; height: number };
    };
    const width = Math.ceil(cssContentSize.width);
    const height = Math.ceil(cssContentSize.height);
    // Never silently crop a long conversation or allocate an unbounded bitmap.
    if (!Number.isFinite(height) || height < 1 || height > MAX_IMAGE_HEIGHT || width > IMAGE_WIDTH) {
      throw new Error('Conversation image is too large. Select fewer messages or export as HTML/Markdown.');
    }
    const { data } = await contents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    }) as { data: string };
    const png = Buffer.from(data, 'base64');
    if (!png.length) throw new Error('Conversation image could not be rendered.');
    return png;
  }
}
