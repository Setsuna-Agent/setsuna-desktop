import { PointMenu } from '@setsuna-desktop/renderer-ui';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { BrowserContextMenuRequest, BrowserDesktopBridge } from '../contracts/index.js';

export function BrowserContextMenu({ bridge, active, webviewRef }: {
  bridge: BrowserDesktopBridge | null;
  active: boolean;
  webviewRef: RefObject<{ getWebContentsId(): number } | null>;
}) {
  const [request, setRequest] = useState<BrowserContextMenuRequest | null>(null);
  const currentRequest = useRef<BrowserContextMenuRequest | null>(null);
  const close = useCallback(() => {
    const current = currentRequest.current;
    currentRequest.current = null;
    setRequest(null);
    if (current) void bridge?.dismissContextMenu(current.id).catch((error) => {
      console.warn('[browser] could not dismiss context menu', error);
    });
  }, [bridge]);

  useEffect(() => {
    if (!active || !bridge) return;
    const unsubscribe = bridge.onContextMenu((next) => {
      let guestId: number | undefined;
      try { guestId = webviewRef.current?.getWebContentsId(); } catch { /* Guest may have detached. */ }
      const ownRequest = next?.webContentsId === guestId ? next : null;
      currentRequest.current = ownRequest;
      setRequest(ownRequest);
    });
    return () => { unsubscribe(); close(); };
  }, [active, bridge, close, webviewRef]);

  if (!active || !request || !bridge) return null;
  return <PointMenu key={request.id} x={request.x} y={request.y} modal onClose={close} menu={{
    items: request.items.map(({ shortcut, ...item }) => ({ ...item, extra: shortcut ? <span className="sd-menu__extra">{shortcut}</span> : undefined })),
    onClick: ({ key }) => {
      // Selection consumes the session; the subsequent Radix dismissal must not cancel it.
      currentRequest.current = null;
      setRequest(null);
      void bridge.runContextMenuAction(request.id, key).catch((error) => {
        console.warn('[browser] context menu action failed', error);
      });
    },
  }} />;
}
