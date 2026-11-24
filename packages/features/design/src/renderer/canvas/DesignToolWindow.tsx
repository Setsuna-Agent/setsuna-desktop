import { GripHorizontal, X } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type PointerEvent } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, Popover } from '@setsuna-desktop/renderer-ui';
import type { Bounds, Point } from '../design-geometry.js';
import { adjustDesignToolWindow, constrainDesignToolWindow, designToolWindowEdges, type DesignToolWindowGrip } from './design-tool-window-bounds.js';
import './design-tool-window.css';

type Props = Pick<ComponentProps<typeof Popover>, 'children' | 'content' | 'contentLabel' | 'onCloseAutoFocus' | 'onOpenChange' | 'placement' | 'sideOffset'>
  & Readonly<{ kind: string; open: boolean; translate: RendererTranslate }>;
type WindowDrag = Readonly<{
  id: number;
  grip: DesignToolWindowGrip;
  point: Point;
  frame: Bounds;
  minimum: Pick<Bounds, 'width' | 'height'>;
}> & { moved: boolean };

const arrowSteps: Partial<Record<string, Point>> = {
  ArrowLeft: { x: -12, y: 0 }, ArrowRight: { x: 12, y: 0 }, ArrowUp: { x: 0, y: -12 }, ArrowDown: { x: 0, y: 12 },
};

function windowViewport(): Bounds {
  const inset = 8;
  return { x: inset, y: inset, width: Math.max(1, window.innerWidth - 2 * inset), height: Math.max(1, window.innerHeight - 2 * inset) };
}

function measureWindow(target: HTMLElement) {
  const panel = target.closest<HTMLElement>('.design-tool-popover--window');
  if (!panel) return undefined;
  const { left: x, top: y, width, height } = panel.getBoundingClientRect();
  if (!width || !height) return undefined;
  // The popover portal positions in viewport pixels while its content follows the app's UI scale.
  const scale = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--app-page-scale')) || 1;
  return { frame: { x, y, width, height }, minimum: { width: 280 * scale, height: 200 * scale } };
}

export function DesignToolWindow({ kind, open, content, translate: t, ...popover }: Props) {
  const [frame, setFrame] = useState<Bounds>();
  const drag = useRef<WindowDrag>();
  const x = frame?.x;
  const y = frame?.y;
  const getAnchorRect = useCallback(() => new DOMRect(x, y, 0, 0), [x, y]);

  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => setFrame((current) => current && constrainDesignToolWindow(current, windowViewport()));
    fit();
    window.addEventListener('resize', fit);
    return () => {
      drag.current = undefined;
      window.removeEventListener('resize', fit);
    };
  }, [open]);

  function begin(event: PointerEvent<HTMLElement>, grip: DesignToolWindowGrip) {
    if (event.button !== 0 || drag.current) return;
    const measured = measureWindow(event.currentTarget);
    if (!measured) return;
    event.preventDefault();
    drag.current = { id: event.pointerId, grip, point: { x: event.clientX, y: event.clientY }, ...measured, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    const delta = { x: event.clientX - active.point.x, y: event.clientY - active.point.y };
    if (!active.moved && !delta.x && !delta.y) return;
    active.moved = true;
    setFrame(adjustDesignToolWindow(active.frame, active.grip, delta, windowViewport(), active.minimum));
  }

  function release(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id === event.pointerId) drag.current = undefined;
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    const delta = arrowSteps[event.key];
    if (!delta || event.altKey || event.ctrlKey || event.metaKey || drag.current) return;
    const measured = measureWindow(event.currentTarget);
    if (!measured) return;
    event.preventDefault();
    event.stopPropagation();
    setFrame(adjustDesignToolWindow(frame ?? measured.frame, event.shiftKey ? 'bottom-right' : 'move', delta, windowViewport(), measured.minimum));
  }

  const pointerHandlers = {
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => { move(event); release(event); },
    onPointerCancel: release,
    onLostPointerCapture: release,
  };
  const label = t('feature.design.toolWindowHandle');
  return <Popover {...popover} open={open} placement={frame ? 'bottomLeft' : popover.placement} sideOffset={frame ? 0 : popover.sideOffset}
    getAnchorRect={frame ? getAnchorRect : undefined} avoidCollisions={!frame} onInteractOutside={(event) => event.preventDefault()}
    className={`design-tool-popover design-tool-popover--${kind} design-tool-popover--window${frame ? ' design-tool-popover--floating' : ''}`}
    style={frame ? {
      width: `calc(${frame.width}px * var(--app-page-scale-inverse, 1))`,
      height: `calc(${frame.height}px * var(--app-page-scale-inverse, 1))`,
    } : undefined}
    content={open ? <>
      <div className="design-tool-popover__content">{content}</div>
      <header className="design-tool-window__header">
        <div className="design-tool-window__grip" role="group" tabIndex={0} title={label} aria-label={label}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
          onKeyDown={keyDown} onPointerDown={(event) => begin(event, 'move')} {...pointerHandlers}>
          <GripHorizontal size={16} aria-hidden="true" />
        </div>
        <IconButton className="design-tool-window__close" size="small" label={t('feature.design.close')}
          onClick={() => popover.onOpenChange?.(false)}><X size={15} /></IconButton>
      </header>
      {designToolWindowEdges.map((edge) => <span key={edge} className="design-tool-window__edge" data-edge={edge} aria-hidden="true"
        onPointerDown={(event) => begin(event, edge)} {...pointerHandlers} />)}
    </> : null} />;
}
