import { IconButton, PanelPlacementIcon, ResizeHandle } from '@setsuna-desktop/renderer-ui';
import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState,
  type ComponentProps, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { DesignToolbarPosition } from '../context/design-canvas-settings.js';

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
const InspectorExitContext = createContext<(() => void) | undefined>(undefined);

function panelWidth({ min, max, initial }: PanelBounds, preferred = initial) {
  return Math.max(min, Math.min(max, Math.round(preferred)));
}

export function DesignPanelLayout({ layersOpen, inspectorOpen, hasChat, toolbarPosition, children }: Readonly<{
  layersOpen: boolean;
  inspectorOpen: boolean;
  hasChat: boolean;
  toolbarPosition?: DesignToolbarPosition;
  children: ReactNode;
}>) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(Infinity);
  const [workspace, setWorkspace] = useState<HTMLElement | null>(null);
  const [preferred, setPreferred] = useState<Partial<PanelWidths>>({});
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    setWorkspace(element.closest<HTMLElement>('.design-workspace__editing'));
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
    initial: Math.min(272, Math.floor(availableWidth * 0.32)),
  };
  const inspectorWidth = panelWidth(standard, preferred.inspector);
  // Reserve room for the tool rail and a usable strip of canvas between open panels.
  const availableSidebarSpace = Math.max(0, availableWidth - 160);
  const sidebarLimit = Math.max(0, availableSidebarSpace - (inspectorOpen ? inspectorWidth : 0));
  const sidebarSpace = Math.floor(availableWidth * (inspectorOpen ? 0.55 : 0.72));
  const initialLayersWidth = hasChat ? 384 : workspace ? 312 : standard.initial;
  const layersMax = Math.min(sidebarLimit, hasChat ? Math.min(520, sidebarSpace) : standard.max);
  const bounds = {
    inspector: standard,
    layers: {
      min: Math.min(standard.min, layersMax),
      max: layersMax,
      initial: workspace ? Math.min(initialLayersWidth, Math.floor(availableWidth * 0.4)) : initialLayersWidth,
    },
  };
  const defaultLayersWidth = panelWidth(bounds.layers);
  const widths = { layers: panelWidth(bounds.layers, preferred.layers), inspector: inspectorWidth };
  useLayoutEffect(() => {
    if (!workspace) return;
    // Keep room for adjacent canvas controls when the file bar is full.
    workspace.style.setProperty('--design-file-bar-max-width', `${defaultLayersWidth}px`);
    return () => { workspace.style.removeProperty('--design-file-bar-max-width'); };
  }, [workspace, defaultLayersWidth]);
  function resize(side: SidePanel, width: number) {
    const next = panelWidth(bounds[side], width);
    if (next !== widths[side]) setPreferred((current) => ({ ...current, [side]: next }));
  }

  return <PanelLayoutContext.Provider value={{ container, bounds, widths, resize }}>
    <div ref={container} className="design-editor__body" data-layers={layersOpen} data-inspector={inspectorOpen} data-toolbar-position={toolbarPosition}
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

export function DesignInspectorPresence({ children }: Readonly<{ children: ReactElement | null }>) {
  const [lastPanel, setLastPanel] = useState(children);
  // Deselecting clears the inspector's inputs. Retain its last contents for the exit transition.
  if (children && children !== lastPanel) setLastPanel(children);
  const finishExit = useCallback(() => setLastPanel(null), []);
  return <InspectorExitContext.Provider value={children ? undefined : finishExit}>
    {children ?? lastPanel}
  </InspectorExitContext.Provider>;
}

export function DesignSidePanel({ side, id, label, resizeLabel, open = true, title, fullscreen, actions, collapse, onExitComplete, children }: Readonly<{
  side: SidePanel;
  id?: string;
  label: string;
  resizeLabel: string;
  open?: boolean;
  title?: ReactNode;
  fullscreen?: boolean;
  actions?: ReactNode;
  collapse?: Pick<PanelToggleProps, 'label' | 'onClick' | 'buttonRef'>;
  onExitComplete?(): void;
  children: ReactNode;
}>) {
  const fallbackId = useId();
  const panelId = id ?? fallbackId;
  const panel = useRef<HTMLElement>(null);
  const finishInspectorExit = useContext(InspectorExitContext);
  const shown = open && !finishInspectorExit;
  const finishExit = finishInspectorExit ?? onExitComplete;
  useLayoutEffect(() => {
    if (shown || !finishExit) return;
    const transitions = panel.current?.getAnimations?.() ?? [];
    // Use the actual CSS transitions so reduced motion can release the panel immediately.
    if (!transitions.length) { finishExit(); return; }
    let closing = true;
    void Promise.allSettled(transitions.map(({ finished }) => finished)).then(() => { if (closing) finishExit(); });
    return () => { closing = false; };
  }, [shown, finishExit]);

  return <aside ref={panel} id={panelId} hidden={!shown} data-fullscreen={shown && fullscreen || undefined}
    className={`design-editor__${side}`} aria-label={label} {...{ inert: shown ? undefined : '' }}>
    <header className="design-panel__header">
      {title ?? <h2>{label}</h2>}
      {(shown || finishExit) && (actions || collapse) ? <div className="design-panel__actions">
        {actions}
        {collapse && !fullscreen ? <DesignPanelToggle side={side} aria-expanded={true} aria-controls={panelId} {...collapse}
          buttonRef={shown ? collapse.buttonRef : undefined} /> : null}
      </div> : null}
    </header>
    {shown && !fullscreen ? <DesignPanelResize side={side} label={resizeLabel} controls={panelId} /> : null}
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
