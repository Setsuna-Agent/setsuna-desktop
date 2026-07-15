import { useEffect, useRef, useState } from 'react';
import { EllipsisVertical, Minus, Plus } from 'lucide-react';

const minimumBrowserZoomFactor = 0.5;
const maximumBrowserZoomFactor = 3;

export function BrowserWindowMenu({
  disabled,
  loading,
  onOpenDevTools,
  onPrint,
  onReload,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoomFactor,
}: {
  disabled: boolean;
  loading: boolean;
  onOpenDevTools: () => void;
  onPrint: () => void;
  onReload: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
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
        aria-label="浏览器菜单"
        className={`desktop-browser-navigation__button ${open ? 'is-active' : ''}`}
        disabled={disabled}
        ref={triggerRef}
        title="浏览器菜单"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisVertical size={16} />
      </button>
      <span className="desktop-browser-window-menu__popover" hidden={!open} role="menu" aria-label="浏览器窗口设置">
        <button type="button" role="menuitem" onClick={() => runAndClose(onReload)}>
          {loading ? '停止加载' : '重新加载页面'}
        </button>
        <button type="button" role="menuitem" onClick={() => runAndClose(onPrint)}>
          打印页面
        </button>
        <span className="desktop-browser-window-menu__separator" role="separator" />
        <span className="desktop-browser-window-menu__zoom" role="group" aria-label="页面缩放">
          <span>缩放</span>
          <span className="desktop-browser-window-menu__zoom-controls">
            <button
              aria-label="缩小页面"
              disabled={zoomFactor <= minimumBrowserZoomFactor}
              role="menuitem"
              type="button"
              onClick={onZoomOut}
            >
              <Minus size={13} />
            </button>
            <button aria-label="恢复默认缩放" role="menuitem" title="恢复默认缩放" type="button" onClick={onZoomReset}>
              {Math.round(zoomFactor * 100)}%
            </button>
            <button
              aria-label="放大页面"
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
          打开开发者工具
        </button>
      </span>
    </span>
  );
}
