import { ResizeHandle } from '@setsuna-desktop/renderer-ui';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePrText } from './context.js';
import { DEFAULT_PR_SIDEBAR_WIDTH, type PullRequestSession } from './session.js';

export function PullRequestsSplit({ sidebar, children, session }: {
  sidebar: ReactNode; children: ReactNode; session: PullRequestSession;
}) {
  const t = usePrText();
  const container = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number; scale: number } | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState(session.sidebarWidth ?? DEFAULT_PR_SIDEBAR_WIDTH);
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

  // A smaller window limits the visible width without discarding the preference.
  const min = availableWidth ? Math.min(280, Math.floor(availableWidth / 2)) : 280;
  const max = Math.max(min, Math.min(520, availableWidth ? availableWidth - 360 : 520));
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));
  const width = clamp(preferredWidth);
  const change = (value: number) => { const next = clamp(value); setPreferredWidth(next); session.sidebarWidth = next; };
  const stop = () => { drag.current = null; setResizing(false); };

  return <section
    className={`pr-workbench${sidebar ? '' : ' pr-workbench--connection'}`} data-feature-id="pull-requests" ref={container}
    style={{ '--pr-sidebar-width': `${width}px` } as CSSProperties}
  >
    {sidebar}
    {sidebar ? <ResizeHandle
      className={`pr-sidebar__resize-handle${resizing ? ' is-resizing' : ''}`}
      aria-label={t('resizeSidebar')} title={t('resizeSidebarHint')}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
      onPointerDown={(event) => {
        const element = container.current;
        if (event.button !== 0 || !element) return;
        const bounds = element.getBoundingClientRect();
        if (!bounds.width) return;
        event.preventDefault();
        // Pointer coordinates include UI zoom; sidebar widths use CSS pixels.
        drag.current = { pointerId: event.pointerId, x: event.clientX, width, scale: element.clientWidth / bounds.width };
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId) change(start.width + (event.clientX - start.x) * start.scale);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        stop();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowLeft' ? width - 16 : event.key === 'ArrowRight' ? width + 16
          : event.key === 'Home' ? min : event.key === 'End' ? max : null;
        if (next === null) return;
        event.preventDefault();
        change(next);
      }}
    /> : null}
    {children}
  </section>;
}
