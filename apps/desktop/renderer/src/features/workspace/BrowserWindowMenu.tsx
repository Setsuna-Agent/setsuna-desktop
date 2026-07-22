import { EllipsisVertical, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

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
  zoomFactor: number;
}) {
  const { t } = useI18n();
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
        aria-label={t('workspace.browser.menu')}
        className={`desktop-browser-navigation__button ${open ? 'is-active' : ''}`}
        disabled={disabled}
        ref={triggerRef}
        title={t('workspace.browser.menu')}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisVertical size={16} />
      </button>
      <span className="desktop-browser-window-menu__popover" hidden={!open} role="menu" aria-label={t('workspace.browser.menuSettings')}>
        <button type="button" role="menuitem" onClick={() => runAndClose(onReload)}>
          {t(loading ? 'workspace.browser.stop' : 'workspace.browser.reload')}
        </button>
        <button type="button" role="menuitem" onClick={() => runAndClose(onPrint)}>
          {t('workspace.browser.print')}
        </button>
        <button
          aria-busy={capturingScreenshot}
          disabled={capturingScreenshot}
          type="button"
          role="menuitem"
          onClick={() => runAndClose(onCaptureScreenshot)}
        >
          {t(capturingScreenshot ? 'workspace.browser.capturingScreenshot' : 'workspace.browser.captureScreenshot')}
        </button>
        <button type="button" role="menuitem" onClick={() => runAndClose(onToggleDeviceToolbar)}>
          {t(deviceToolbarVisible ? 'workspace.browser.hideDeviceToolbar' : 'workspace.browser.showDeviceToolbar')}
        </button>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <span className="desktop-browser-window-menu__zoom" role="group" aria-label={t('workspace.browser.pageZoom')}>
          <span>{t('workspace.browser.zoom')}</span>
          <span className="desktop-browser-window-menu__zoom-controls">
            <button
              aria-label={t('workspace.browser.zoomOut')}
              disabled={zoomFactor <= minimumBrowserZoomFactor}
              role="menuitem"
              type="button"
              onClick={onZoomOut}
            >
              <Minus size={13} />
            </button>
            <button aria-label={t('workspace.browser.zoomReset')} role="menuitem" title={t('workspace.browser.zoomReset')} type="button" onClick={onZoomReset}>
              {Math.round(zoomFactor * 100)}%
            </button>
            <button
              aria-label={t('workspace.browser.zoomIn')}
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
          {t('workspace.browser.openDevTools')}
        </button>
      </span>
    </span>
  );
}
