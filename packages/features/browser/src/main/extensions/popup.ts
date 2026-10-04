import { BrowserWindow, screen, type Rectangle, type Session, type Size } from 'electron';
import type { BrowserExtensionPopupAnchor } from '../../contracts/extensions.js';

/** Native extension rendering in a transient surface, without a desktop preload. */
export function createExtensionPopup(owner: BrowserWindow, session: Session, anchor?: BrowserExtensionPopupAnchor): BrowserWindow {
  const position = (size: Size) => popupBounds(owner, anchor, size);
  const popup = new BrowserWindow({
    // Start short: quirks-mode extension pages treat the viewport as their minimum height.
    parent: owner, ...position({ width: 320, height: 40 }),
    show: false, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    hasShadow: true, autoHideMenuBar: true,
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: true },
  });
  const close = () => { if (!popup.isDestroyed()) popup.destroy(); };
  popup.on('blur', close);
  popup.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); close(); }
  });
  popup.webContents.on('preferred-size-changed', (_event, size) => {
    if (popup.isDestroyed() || owner.isDestroyed() || size.width <= 0 || size.height <= 0) return;
    popup.setBounds(position(size));
  });
  // The icon's viewport anchor becomes stale when its owner moves or changes size.
  owner.on('move', close).on('resize', close).on('hide', close).on('minimize', close).on('closed', close);
  popup.once('closed', () => {
    owner.off('move', close).off('resize', close).off('hide', close).off('minimize', close).off('closed', close);
  });
  return popup;
}

function popupBounds(owner: BrowserWindow, anchor: BrowserExtensionPopupAnchor | undefined, size: Size): Rectangle {
  const content = owner.getContentBounds();
  const zoom = owner.webContents.getZoomFactor();
  const right = content.x + Math.min(content.width, anchor ? (anchor.x + anchor.width) * zoom : content.width - 8);
  const bottom = content.y + Math.min(content.height, anchor ? (anchor.y + anchor.height) * zoom : 40);
  const workArea = screen.getDisplayNearestPoint({ x: Math.round(right), y: Math.round(bottom) }).workArea;
  const width = Math.min(Math.max(40, Math.ceil(size.width)), 800, workArea.width - 16);
  const height = Math.min(Math.max(40, Math.ceil(size.height)), 600, workArea.height - 16);
  const x = Math.max(workArea.x + 8, Math.min(right - width, workArea.x + workArea.width - width - 8));
  const y = Math.max(workArea.y + 8, Math.min(bottom + 6, workArea.y + workArea.height - height - 8));
  return { x: Math.round(x), y: Math.round(y), width, height };
}
