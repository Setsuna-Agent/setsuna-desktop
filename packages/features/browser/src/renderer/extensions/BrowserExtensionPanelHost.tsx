import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserDesktopBridge } from '../../contracts/index.js';
import { translateBrowserMessage, type BrowserTranslate } from '../messages.js';
import type { BrowserNotify } from '../types.js';
import { BrowserExtensionSidePanel } from './BrowserExtensionSidePanel.js';
import { BrowserExtensionPanelHostContext, type BrowserExtensionPanelSlot } from './useBrowserExtensionPanelSlot.js';
import { useBrowserExtensionPanel } from './useBrowserExtensionPanel.js';
import { useBrowserExtensionPanelPosition } from './useBrowserExtensionPanelPosition.js';
import { useInstalledBrowserExtensions } from './useInstalledBrowserExtensions.js';

const fallbackTranslate: BrowserTranslate = (key) => translateBrowserMessage('zh-CN', key);

export function BrowserExtensionPanelHost({ bridge, notify, children }: {
  bridge: BrowserDesktopBridge | null;
  notify: BrowserNotify;
  children: ReactNode;
}) {
  const panel = useBrowserExtensionPanel(bridge);
  const { extensions } = useInstalledBrowserExtensions(bridge);
  const [slots, setSlots] = useState(() => new Map<string, BrowserExtensionPanelSlot>());
  const [selectedId, setSelectedId] = useState<string>();
  const [width, setWidth] = useState(400);
  const emptyContentRef = useRef<HTMLDivElement>(null);
  const register = useCallback((slot: BrowserExtensionPanelSlot) => {
    setSlots((current) => new Map(current).set(slot.id, slot));
    return () => setSlots((current) => {
      if (current.get(slot.id) !== slot) return current;
      const next = new Map(current); next.delete(slot.id); return next;
    });
  }, []);
  const candidates = [...slots.values()].filter((slot) => slot.visible
    && (panel?.webContentsId === undefined || panel.webContentsId === slot.webContentsId));
  const active = candidates.find((slot) => slot.id === selectedId) ?? candidates.at(-1);
  const translate = active?.translate ?? slots.values().next().value?.translate ?? fallbackTranslate;
  const visible = Boolean(active && panel && extensions.some(({ id, enabled }) => enabled && id === panel.id));
  const position = useBrowserExtensionPanelPosition(visible ? active?.slotRef : undefined);
  const context = useMemo(() => ({ register, activate: setSelectedId,
    activeId: visible ? active?.id : undefined, width: visible ? width : 0 }), [register, active?.id, visible, width]);
  const close = () => {
    void bridge?.closeExtensionPanel().then((closed) => {
      if (!closed) notify('error', translate('feature.browser.extension.failed'));
    }).catch(() => notify('error', translate('feature.browser.extension.failed')));
  };

  return <BrowserExtensionPanelHostContext.Provider value={context}>
    {children}
    {createPortal(<BrowserExtensionSidePanel panel={panel} extensions={extensions}
      contentRef={active?.contentRef ?? emptyContentRef} visible={visible} position={position}
      translate={translate} onClose={close} onWidthChange={setWidth} />, document.body)}
  </BrowserExtensionPanelHostContext.Provider>;
}
