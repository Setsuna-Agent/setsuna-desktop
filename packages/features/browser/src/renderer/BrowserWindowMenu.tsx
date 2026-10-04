import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import { EllipsisVertical, History, Minus, Plus, Settings2, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BrowserTranslate } from './messages.js';
import type { BrowserRecordsKind } from './records/BrowserRecordsManager.js';

const minimumBrowserZoomFactor = 0.5;
const maximumBrowserZoomFactor = 3;

export function BrowserWindowMenu({
  capturingScreenshot,
  deviceToolbarVisible,
  disabled,
  hidden = false,
  loading,
  onOpenDevTools,
  onCaptureScreenshot,
  onPrint,
  onReload,
  onToggleDeviceToolbar,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onOpenSettings,
  onOpenRecords,
  translate,
  zoomFactor,
}: {
  capturingScreenshot: boolean;
  deviceToolbarVisible: boolean;
  disabled: boolean;
  hidden?: boolean;
  loading: boolean;
  onOpenDevTools: () => void;
  onCaptureScreenshot: () => void;
  onPrint: () => void;
  onReload: () => void;
  onToggleDeviceToolbar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onOpenSettings?: () => void;
  onOpenRecords: (kind: BrowserRecordsKind) => void;
  translate: BrowserTranslate;
  zoomFactor: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);

  const runAndClose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <span className="desktop-browser-window-menu">
      <Popover open={open && !hidden} onOpenChange={setOpen} modal placement="bottomRight" className="sd-menu-surface desktop-browser-window-menu__popover"
        contentLabel={translate('feature.browser.menuSettings')} content={<>
        <Button variant="ghost" type="button" role="menuitem" onClick={() => runAndClose(() => onOpenRecords('history'))}>
          <History size={14} />{translate('feature.browser.settings.history')}
        </Button>
        <Button variant="ghost" type="button" role="menuitem" onClick={() => runAndClose(() => onOpenRecords('bookmarks'))}>
          <Star size={14} />{translate('feature.browser.settings.bookmarks')}
        </Button>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <Button variant="ghost" type="button" disabled={disabled} role="menuitem" onClick={() => runAndClose(onReload)}>
          {translate(loading ? 'feature.browser.stop' : 'feature.browser.reload')}
        </Button>
        <Button variant="ghost" type="button" disabled={disabled} role="menuitem" onClick={() => runAndClose(onPrint)}>
          {translate('feature.browser.print')}
        </Button>
        <Button variant="ghost"
          aria-busy={capturingScreenshot}
          disabled={disabled || capturingScreenshot}
          type="button"
          role="menuitem"
          onClick={() => runAndClose(onCaptureScreenshot)}
        >
          {translate(capturingScreenshot ? 'feature.browser.capturingScreenshot' : 'feature.browser.captureScreenshot')}
        </Button>
        <Button variant="ghost" type="button" disabled={disabled} role="menuitem" onClick={() => runAndClose(onToggleDeviceToolbar)}>
          {translate(deviceToolbarVisible ? 'feature.browser.hideDeviceToolbar' : 'feature.browser.showDeviceToolbar')}
        </Button>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <span className="desktop-browser-window-menu__zoom" role="group" aria-label={translate('feature.browser.pageZoom')}>
          <span>{translate('feature.browser.zoom')}</span>
          <span className="desktop-browser-window-menu__zoom-controls">
            <Button variant="ghost"
              aria-label={translate('feature.browser.zoomOut')}
              disabled={disabled || zoomFactor <= minimumBrowserZoomFactor}
              role="menuitem"
              type="button"
              onClick={onZoomOut}
            >
              <Minus size={13} />
            </Button>
            <Button variant="ghost" disabled={disabled} aria-label={translate('feature.browser.zoomReset')} role="menuitem" title={translate('feature.browser.zoomReset')} type="button" onClick={onZoomReset}>
              {Math.round(zoomFactor * 100)}%
            </Button>
            <Button variant="ghost"
              aria-label={translate('feature.browser.zoomIn')}
              disabled={disabled || zoomFactor >= maximumBrowserZoomFactor}
              role="menuitem"
              type="button"
              onClick={onZoomIn}
            >
              <Plus size={13} />
            </Button>
          </span>
        </span>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <Button variant="ghost" type="button" disabled={disabled} role="menuitem" onClick={() => runAndClose(onOpenDevTools)}>
          {translate('feature.browser.openDevTools')}
        </Button>
        {onOpenSettings ? <>
          <span className="desktop-browser-window-menu__separator" role="separator" />
          <Button variant="ghost" type="button" role="menuitem" onClick={() => runAndClose(onOpenSettings)}><Settings2 size={14} />{translate('feature.browser.settings.open')}</Button>
        </> : null}
      </>}>
        <Button variant="ghost" aria-label={translate('feature.browser.menu')} title={translate('feature.browser.menu')}
          className={`desktop-browser-navigation__button ${open ? 'is-active' : ''}`}><EllipsisVertical size={16} /></Button>
      </Popover>
    </span>
  );
}
