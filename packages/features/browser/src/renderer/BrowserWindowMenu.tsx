import { EllipsisVertical, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserTranslate } from './messages.js';

const minimumBrowserZoomFactor = 0.5;
const maximumBrowserZoomFactor = 3;

export function BrowserWindowMenu({
  capturingScreenshot,
  deviceToolbarVisible,
  disabled,
  loading,
  onOpenDevTools,
  onCaptureScreenshot,
  onPrint,
  onReload,
  onToggleDeviceToolbar,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  translate,
  zoomFactor,
}: {
  capturingScreenshot: boolean;
  deviceToolbarVisible: boolean;
  disabled: boolean;
  loading: boolean;
  onOpenDevTools: () => void;
  onCaptureScreenshot: () => void;
  onPrint: () => void;
  onReload: () => void;
  onToggleDeviceToolbar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  translate: BrowserTranslate;
  zoomFactor: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const runAndClose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <span className="desktop-browser-window-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={translate('feature.browser.menu')}
        className={`desktop-browser-navigation__button ${open ? 'is-active' : ''}`}
        disabled={disabled}
        ref={triggerRef}
        title={translate('feature.browser.menu')}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisVertical size={16} />
      </button>
      <span className="desktop-browser-window-menu__popover" hidden={!open} role="menu" aria-label={translate('feature.browser.menuSettings')}>
        <button type="button" role="menuitem" onClick={() => runAndClose(onReload)}>
          {translate(loading ? 'feature.browser.stop' : 'feature.browser.reload')}
        </button>
        <button type="button" role="menuitem" onClick={() => runAndClose(onPrint)}>
          {translate('feature.browser.print')}
        </button>
        <button
          aria-busy={capturingScreenshot}
          disabled={capturingScreenshot}
          type="button"
          role="menuitem"
          onClick={() => runAndClose(onCaptureScreenshot)}
        >
          {translate(capturingScreenshot ? 'feature.browser.capturingScreenshot' : 'feature.browser.captureScreenshot')}
        </button>
        <button type="button" role="menuitem" onClick={() => runAndClose(onToggleDeviceToolbar)}>
          {translate(deviceToolbarVisible ? 'feature.browser.hideDeviceToolbar' : 'feature.browser.showDeviceToolbar')}
        </button>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <span className="desktop-browser-window-menu__zoom" role="group" aria-label={translate('feature.browser.pageZoom')}>
          <span>{translate('feature.browser.zoom')}</span>
          <span className="desktop-browser-window-menu__zoom-controls">
            <button
              aria-label={translate('feature.browser.zoomOut')}
              disabled={zoomFactor <= minimumBrowserZoomFactor}
              role="menuitem"
              type="button"
              onClick={onZoomOut}
            >
              <Minus size={13} />
            </button>
            <button aria-label={translate('feature.browser.zoomReset')} role="menuitem" title={translate('feature.browser.zoomReset')} type="button" onClick={onZoomReset}>
              {Math.round(zoomFactor * 100)}%
            </button>
            <button
              aria-label={translate('feature.browser.zoomIn')}
              disabled={zoomFactor >= maximumBrowserZoomFactor}
              role="menuitem"
              type="button"
              onClick={onZoomIn}
            >
              <Plus size={13} />
            </button>
          </span>
        </span>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <button type="button" role="menuitem" onClick={() => runAndClose(onOpenDevTools)}>
          {translate('feature.browser.openDevTools')}
        </button>
      </span>
    </span>
  );
}
