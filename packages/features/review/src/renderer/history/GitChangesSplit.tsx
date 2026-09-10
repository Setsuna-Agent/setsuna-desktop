import { ResizeHandle } from '@setsuna-desktop/renderer-ui';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReviewRendererHost } from '../host.js';

export function GitChangesSplit({ navigation, children, detailOpen, editingMessage }: {
  navigation: ReactNode;
  children: ReactNode;
  detailOpen: boolean;
  editingMessage: boolean;
}) {
  const { translate: t } = useReviewRendererHost();
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number; scale: number } | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Match the compact editor split while retaining the user's preferred width
  // when a smaller workspace temporarily limits the space available to it.
  const compact = availableWidth <= 560;
  const min = compact ? Math.min(160, availableWidth / 2) : 220;
  const max = Math.max(min, availableWidth - (compact ? 160 : 240));
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));
  const defaultWidth = compact ? Math.max(160, Math.min(280, availableWidth * 0.36)) : 260;
  const width = clamp(preferredWidth ?? defaultWidth);
  const stopResize = () => { drag.current = null; setResizing(false); };

  return (
    <div
      className={'git-changes-panel__body' + (detailOpen ? ' has-detail' : '') + (editingMessage ? ' has-message-editor' : '') + (resizing ? ' is-resizing' : '')}
      ref={container}
      style={availableWidth ? { '--git-nav-width': width + 'px' } as CSSProperties : undefined}
    >
      {children}
      <ResizeHandle
        className={'desktop-review-file-tree__resize-handle git-changes-panel__resize-handle' + (resizing ? ' is-resizing' : '')}
        type="button"
        role="separator"
        aria-label={t('feature.review.history.resizeSidebar')}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        title={t('feature.review.workspace.fileBrowser.resizeHint')}
        onPointerDown={(event) => {
          const element = container.current;
          if (event.button !== 0 || !element) return;
          event.preventDefault();
          const bounds = element.getBoundingClientRect();
          if (!bounds.width) return;
          // Pointer coordinates include UI zoom; flex widths use CSS pixels.
          drag.current = { pointerId: event.pointerId, x: event.clientX, width, scale: element.clientWidth / bounds.width };
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.pointerId !== event.pointerId) return;
          // The sidebar is anchored to the right, so moving its edge left widens it.
          setPreferredWidth(clamp(start.width + (start.x - event.clientX) * start.scale));
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          stopResize();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={stopResize}
        onLostPointerCapture={stopResize}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowLeft' ? width + 16 : event.key === 'ArrowRight' ? width - 16
            : event.key === 'Home' ? min : event.key === 'End' ? max : null;
          if (next === null) return;
          event.preventDefault();
          setPreferredWidth(clamp(next));
        }}
      />
      {navigation}
    </div>
  );
}
