import { IconButton, PanelPlacementIcon, ResizeHandle } from '@setsuna-desktop/renderer-ui';
import { createContext, useContext, useId, useLayoutEffect, useRef, useState,
  type ComponentProps, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react';

type SidePanel = 'layers' | 'inspector';
type PanelWidths = Readonly<Record<SidePanel, number>>;
type PanelBounds = Readonly<{ min: number; max: number; initial: number }>;
type PanelLayout = Readonly<{
  container: RefObject<HTMLDivElement>;
  bounds: Readonly<Record<SidePanel, PanelBounds>>;
  widths: PanelWidths;
  resize(side: SidePanel, width: number): void;
}>;

const PanelLayoutContext = createContext<PanelLayout | null>(null);

function panelWidth({ min, max, initial }: PanelBounds, preferred = initial) {
  return Math.max(min, Math.min(max, Math.round(preferred)));
}

export function DesignPanelLayout({ layersOpen, inspectorOpen, hasChat, children }: Readonly<{
  layersOpen: boolean;
  inspectorOpen: boolean;
  hasChat: boolean;
  children: ReactNode;
}>) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(Infinity);
  const [preferred, setPreferred] = useState<Partial<PanelWidths>>({});
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth || Infinity);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A narrow window limits both panels while retaining their individual preferred widths.
  const standard = {
    min: Math.min(224, Math.floor(availableWidth * 0.27)),
    max: Math.min(420, Math.floor(availableWidth * 0.37)),
    initial: Math.min(284, Math.floor(availableWidth * 0.32)),
  };
  const inspectorWidth = panelWidth(standard, preferred.inspector);
  // Reserve room for the tool rail and a usable strip of canvas between open panels.
  const availableSidebarSpace = Math.max(0, availableWidth - 160);
  const sidebarLimit = Math.max(0, availableSidebarSpace - (inspectorOpen ? inspectorWidth : 0));
  const singlePanelMax = Math.floor(availableWidth * 0.72);
  const sidebarSpace = inspectorOpen ? Math.floor(availableWidth * 0.55) : singlePanelMax;
  const initialLayersWidth = Math.min(availableSidebarSpace, hasChat ? Math.min(384, singlePanelMax) : standard.initial);
  const layersMax = Math.min(sidebarLimit, hasChat ? Math.min(520, sidebarSpace) : standard.max);
  const bounds = {
    inspector: standard,
    layers: { min: Math.min(standard.min, layersMax), max: layersMax, initial: initialLayersWidth },
  };
  const widths = { layers: panelWidth(bounds.layers, preferred.layers), inspector: inspectorWidth };
  useLayoutEffect(() => {
    const workspace = container.current?.closest<HTMLElement>('.design-workspace__editing');
    if (!workspace) return;
    // File navigation follows the default layout for the window, independent of panel drags.
    workspace.style.setProperty('--design-default-layers-width', `${initialLayersWidth}px`);
    return () => { workspace.style.removeProperty('--design-default-layers-width'); };
  }, [initialLayersWidth]);
  function resize(side: SidePanel, width: number) {
    const next = panelWidth(bounds[side], width);
    if (next !== widths[side]) setPreferred((current) => ({ ...current, [side]: next }));
  }

  return <PanelLayoutContext.Provider value={{ container, bounds, widths, resize }}>
    <div ref={container} className="design-editor__body" data-layers={layersOpen} data-inspector={inspectorOpen}
      style={{ '--design-layers-width': `${widths.layers}px`, '--design-inspector-width': `${widths.inspector}px` } as CSSProperties}>
      {children}
    </div>
  </PanelLayoutContext.Provider>;
}

type PanelToggleProps = Pick<ComponentProps<typeof IconButton>, 'label' | 'aria-controls' | 'aria-expanded' | 'onClick'>
  & { buttonRef?: ComponentProps<typeof IconButton>['ref'] };

export function DesignPanelToggle({ side, buttonRef, ...props }: PanelToggleProps & Readonly<{ side: SidePanel }>) {
  return <IconButton ref={buttonRef} className="design-panel__toggle" data-side={side} size="small" {...props}>
    <PanelPlacementIcon placement="side" size={16} />
  </IconButton>;
}

export function DesignSidePanel({ side, id, label, resizeLabel, open = true, title, fullscreen, actions, collapse, children }: Readonly<{
  side: SidePanel;
  id?: string;
  label: string;
  resizeLabel: string;
  open?: boolean;
  title?: ReactNode;
  fullscreen?: boolean;
  actions?: ReactNode;
  collapse?: Pick<PanelToggleProps, 'label' | 'onClick' | 'buttonRef'>;
  children: ReactNode;
}>) {
  const fallbackId = useId();
  const panelId = id ?? fallbackId;
  return <aside id={panelId} hidden={!open} data-fullscreen={open && fullscreen || undefined} className={`design-editor__${side}`} aria-label={label}>
    <header className="design-panel__header">
      {title ?? <h2>{label}</h2>}
      {open && (actions || collapse) ? <div className="design-panel__actions">
        {actions}
        {collapse && !fullscreen ? <DesignPanelToggle side={side} aria-expanded={open} aria-controls={panelId} {...collapse} /> : null}
      </div> : null}
    </header>
    {open && !fullscreen ? <DesignPanelResize side={side} label={resizeLabel} controls={panelId} /> : null}
    {children}
  </aside>;
}

function DesignPanelResize({ side, label, controls }: Readonly<{ side: SidePanel; label: string; controls: string }>) {
  const layout = useContext(PanelLayoutContext);
  const drag = useRef<Readonly<{ pointerId: number; x: number; width: number; scale: number }>>();
  const [resizing, setResizing] = useState(false);
  if (!layout) return null;

  const { container, bounds, widths, resize } = layout;
  const { min, max } = bounds[side];
  const width = widths[side];
  const direction = side === 'layers' ? 1 : -1;
  function move(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    resize(side, start.width + (event.clientX - start.x) * start.scale * direction);
  }
  function stop(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setResizing(false);
  }

  return <ResizeHandle className={`design-panel__resize${resizing ? ' is-resizing' : ''}`} aria-label={label} title={label}
    aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    onPointerDown={(event) => {
      const element = container.current;
      if (event.button !== 0 || drag.current || !element?.clientWidth) return;
      const renderedWidth = element.getBoundingClientRect().width;
      if (!renderedWidth) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      // Use CSS pixels even when the application applies density zoom.
      drag.current = { pointerId: event.pointerId, x: event.clientX, width, scale: element.clientWidth / renderedWidth };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setResizing(true);
    }}
    onPointerMove={move} onPointerUp={(event) => { move(event); stop(event); }} onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={(event) => {
      const next = event.key === 'ArrowLeft' ? width - 16 * direction : event.key === 'ArrowRight' ? width + 16 * direction
        : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
      if (next === undefined) return;
      event.preventDefault();
      resize(side, next);
    }} />;
}
