import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import {
  browserDeviceViewportSize,
  dragResizeBrowserDevice,
  resizeBrowserDeviceViewport,
  type BrowserDeviceEmulationState,
  type BrowserDeviceResizeHandle,
} from './browserDeviceEmulation.js';

type BrowserDeviceResizeDrag = {
  handle: BrowserDeviceResizeHandle;
  height: number;
  pointerId: number;
  scale: number;
  startX: number;
  startY: number;
  width: number;
};

const browserDeviceResizeHandles = [
  { handle: 'left', labelKey: 'workspace.browser.resize.left' },
  { handle: 'right', labelKey: 'workspace.browser.resize.right' },
  { handle: 'bottom', labelKey: 'workspace.browser.resize.bottom' },
  { handle: 'bottom-left', labelKey: 'workspace.browser.resize.bottomLeft' },
  { handle: 'bottom-right', labelKey: 'workspace.browser.resize.bottomRight' },
] as const satisfies ReadonlyArray<{ handle: BrowserDeviceResizeHandle; labelKey: MessageKey }>;

export function BrowserDeviceViewport({
  active,
  children,
  deviceEmulation,
  onChange,
}: {
  active: boolean;
  children: ReactNode;
  deviceEmulation: BrowserDeviceEmulationState;
  onChange: (value: BrowserDeviceEmulationState) => void;
}) {
  const { t } = useI18n();
  const animationFrameRef = useRef<number | null>(null);
  const dragRef = useRef<BrowserDeviceResizeDrag | null>(null);
  const onChangeRef = useRef(onChange);
  const pendingValueRef = useRef<BrowserDeviceEmulationState | null>(null);
  onChangeRef.current = onChange;

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const flushPendingValue = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const pendingValue = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pendingValue) onChangeRef.current(pendingValue);
  };

  const scheduleValue = (value: BrowserDeviceEmulationState) => {
    pendingValueRef.current = value;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pendingValue = pendingValueRef.current;
      pendingValueRef.current = null;
      if (pendingValue) onChangeRef.current(pendingValue);
    });
  };

  const resizedValue = (drag: BrowserDeviceResizeDrag, clientX: number, clientY: number) => {
    return dragResizeBrowserDevice(
      { ...deviceEmulation, height: drag.height, scale: drag.scale, width: drag.width },
      drag.handle,
      clientX - drag.startX,
      clientY - drag.startY,
    );
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: BrowserDeviceResizeHandle,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle,
      height: deviceEmulation.height,
      pointerId: event.pointerId,
      scale: deviceEmulation.scale,
      startX: event.clientX,
      startY: event.clientY,
      width: deviceEmulation.width,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    scheduleValue(resizedValue(drag, event.clientX, event.clientY));
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pendingValueRef.current = resizedValue(drag, event.clientX, event.clientY);
    dragRef.current = null;
    flushPendingValue();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    flushPendingValue();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: BrowserDeviceResizeHandle,
  ) => {
    const step = event.shiftKey ? 50 : 10;
    let height = deviceEmulation.height;
    let width = deviceEmulation.width;
    if (event.key === 'ArrowLeft' && handle !== 'bottom') width += handle.endsWith('left') || handle === 'left' ? step : -step;
    else if (event.key === 'ArrowRight' && handle !== 'bottom') width += handle.endsWith('right') || handle === 'right' ? step : -step;
    else if (event.key === 'ArrowUp' && handle.startsWith('bottom')) height -= step;
    else if (event.key === 'ArrowDown' && handle.startsWith('bottom')) height += step;
    else return;
    event.preventDefault();
    onChange(resizeBrowserDeviceViewport(deviceEmulation, { height, width }));
  };

  const viewportSize = browserDeviceViewportSize(deviceEmulation);
  const viewportStyle = viewportSize
    ? { height: `${viewportSize.height}px`, width: `${viewportSize.width}px` } satisfies CSSProperties
    : undefined;
  const resizable = active && deviceEmulation.enabled && deviceEmulation.profileId === 'responsive';

  return (
    <div
      className={[
        'desktop-browser-viewport',
        active ? 'is-active' : '',
        deviceEmulation.enabled ? 'is-device-emulation' : '',
        resizable ? 'is-responsive' : '',
      ].filter(Boolean).join(' ')}
      style={viewportStyle}
    >
      {children}
      {resizable ? browserDeviceResizeHandles.map(({ handle, labelKey }) => (
        <button
          aria-label={t(labelKey)}
          className={`desktop-browser-device-resize-handle desktop-browser-device-resize-handle--${handle}`}
          key={handle}
          title={t(labelKey)}
          type="button"
          onKeyDown={(event) => handleKeyDown(event, handle)}
          onPointerCancel={handlePointerCancel}
          onPointerDown={(event) => handlePointerDown(event, handle)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        />
      )) : null}
    </div>
  );
}
