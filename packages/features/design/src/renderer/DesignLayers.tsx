import {
  ChevronDown, ChevronRight, ChevronsDownUp, Circle, CodeXml, Component, Diamond, Eye, EyeOff, Frame, Globe, Group,
  History, ImageIcon, Layers, Lock, LockOpen, Maximize2, MessageCircle, Minimize2, Square, Type,
} from 'lucide-react';
import { useCallback, useContext, useId, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type MutableRefObject, type ReactElement } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, SegmentedControl, useNativeDragPreview, useReorderLayout } from '@setsuna-desktop/renderer-ui';
import type { DesignDocument } from '../contracts/index.js';
import { DesignThumbnail, useDesignThumbnails } from './canvas/DesignThumbnail.js';
import { DesignPanelToggle, DesignSidePanel } from './canvas/DesignSidePanels.js';
import { useDesignLayerTree } from './canvas/use-design-layer-tree.js';
import { DesignUiHostContext } from './context/design-ui-host.js';
import type { DesignLayerMenuTarget } from './context/use-design-layer-actions.js';
import { activeDesignLayerDrag, canDropDesignLayer, changesDesignLayerOrder, designLayerDragType, designLayerOrder,
  type DesignLayerDestination, type DesignLayerDrag } from './design-layer-drop.js';
import type { LoadDesignImage } from './design-images.js';
import type { DesignScene } from './design-layout.js';
import { DesignChatFullscreenContext, DesignChatPanelContext } from './agent/design-chat-layout.js';
import { designSavedLocation } from './agent/design-resume.js';
import { designVectorIcons } from './vectors/design-vector-icons.js';
import { designLucideIcon } from './vectors/design-vector.js';

const layerIcons = { frame: Frame, image: ImageIcon, rectangle: Square, ellipse: Circle, text: Type, web: Globe, script: CodeXml };

type LayerDrop = DesignLayerDestination & Readonly<{
  id: string;
  placement: 'before' | 'after' | 'inside';
}>;
type LayerOrder = ReturnType<typeof designLayerOrder>;
type LayerHover = Readonly<{
  source: DesignLayerDrag;
  target: LayerDrop | null;
  clientX: number;
  clientY: number;
  scrollTop: number;
}>;

function displayOrder({ ids, frontFirst }: LayerOrder) {
  return frontFirst ? [...ids].reverse() : ids;
}

function beforeIdAtEdge({ ids, frontFirst }: LayerOrder, id: string, edge: 'before' | 'after') {
  // Free layers are listed front to back, while the document paints back to front.
  return (edge === 'after') !== frontFirst ? ids[ids.indexOf(id) + 1] ?? null : id;
}

function layerDepth(depth: number): CSSProperties {
  return { '--design-layer-depth': Math.min(depth, 8) } as CSSProperties;
}

export function DesignLayers({
  document, projected, scene, loadImage, revision, drag, selectedIds, open, disabled, chat, showThumbnails,
  onTogglePanel, onSelect, onHoverLayer, onToggle, onDrop, onContextMenu, translate: t,
}: Readonly<{
  document: DesignDocument;
  projected: DesignDocument;
  scene: DesignScene;
  loadImage: LoadDesignImage;
  revision: string;
  drag: MutableRefObject<DesignLayerDrag | undefined>;
  selectedIds: readonly string[];
  open: boolean;
  disabled: boolean;
  chat?: ReactElement;
  showThumbnails: boolean;
  onTogglePanel(): void;
  onSelect(id: string, additive: boolean): void;
  onHoverLayer(id: string | undefined): void;
  onToggle(id: string, flag: 'locked' | 'hidden'): void;
  onDrop(id: string, destination: DesignLayerDestination, expectedRevision: string): Promise<boolean>;
  onContextMenu(target: DesignLayerMenuTarget): void;
  translate: RendererTranslate;
}>) {
  const panelId = useId();
  const focusNextToggle = useRef(false);
  const restoreToggleFocus = useCallback((button: HTMLButtonElement | null) => {
    if (button && focusNextToggle.current) {
      focusNextToggle.current = false;
      button.focus({ preventScroll: true });
    }
  }, []);
  const [view, setView] = useState<'chat' | 'layers'>('chat');
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const showChat = Boolean(chat) && view === 'chat';
  const fullscreen = showChat && chatFullscreen;
  const layersVisible = open && !showChat;
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const finishExit = useCallback(() => setPresent(false), []);
  const list = useRef<HTMLDivElement>(null);
  const ScrollOverlay = useContext(DesignUiHostContext)?.ScrollOverlay;
  const selectThumbnail = useCallback((id: string) => scene[id]?.visible ? { document: projected, scene, ids: [id] } : undefined, [projected, scene]);
  const observeThumbnail = useDesignThumbnails(list, selectThumbnail, loadImage, { open: layersVisible && showThumbnails });
  const lastHover = useRef<LayerHover>();
  const [hoverDrop, setHoverDrop] = useState<LayerDrop | null>(null);
  const [pendingDrop, setPendingDrop] = useState<Readonly<{ source: DesignLayerDrag; target: LayerDrop }>>();
  const [confirmedDrag, setConfirmedDrag] = useState<DesignLayerDrag>();
  const preview = useNativeDragPreview({ anchor: 'source', liveWithin: list });
  const activeDrag = preview.dragging && layersVisible && !disabled && drag.current?.revision === revision ? drag.current : undefined;
  const saving = layersVisible && pendingDrop?.source.revision === revision ? pendingDrop : undefined;
  const reordering = Boolean(activeDrag || saving);
  const { expandedLayerIds, expandLayers, toggleLayer, collapseAllLayers, revealId, revealRow } = useDesignLayerTree({
    documentId: document.documentId, scene, selectedIds, visible: layersVisible, reordering,
  });
  const liftedId = activeDrag === confirmedDrag ? activeDrag?.id : undefined;
  const slot = (liftedId ? hoverDrop : null) ?? saving?.target;
  const movingId = liftedId ?? saving?.source.id;
  const saved = layersVisible && !selectedIds.length ? designSavedLocation(document, scene) : undefined;
  const rootOrder = designLayerOrder(document, null);
  const roots = displayOrder(rootOrder);
  const hasExpandedLayers = layersVisible && expandedLayerIds.size > 0 && roots.some((id) => {
    const node = document.nodes[id];
    return expandedLayerIds.has(id) && node?.kind === 'frame' && node.childIds.length > 0;
  });
  const layoutKey = movingId ? JSON.stringify([revision, movingId, slot?.parentId, slot?.beforeId]) : revision;
  useReorderLayout(list, layoutKey, reordering);

  useLayoutEffect(() => {
    const owner = list.current?.ownerDocument.defaultView;
    if (!owner || !activeDrag) return;
    const confirm = (event: globalThis.DragEvent) => {
      if (drag.current !== activeDrag || !event.dataTransfer?.types.includes(designLayerDragType)) return;
      // Keep the source in the layout until Chromium has started delivering native drag events.
      setConfirmedDrag(activeDrag);
      owner.removeEventListener('dragover', confirm, true);
    };
    owner.addEventListener('dragover', confirm, true);
    return () => owner.removeEventListener('dragover', confirm, true);
  }, [activeDrag, drag]);

  function dropTarget(event: DragEvent<HTMLDivElement>, source: DesignLayerDrag): LayerDrop | null {
    const target = event.target instanceof Element ? event.target : null;
    const previous = lastHover.current?.source === source ? lastHover.current : undefined;
    if (target?.closest('[data-design-layer-drop-slot]')) return previous?.target ?? null;
    // Letting rows move can retarget native events even when the pointer stays still.
    if (previous?.target && previous.clientX === event.clientX && previous.clientY === event.clientY
      && previous.scrollTop === event.currentTarget.scrollTop) return previous.target;
    const item = target?.closest<HTMLLIElement>('[data-design-layer-id]');
    const id = item?.dataset.designLayerId ?? roots.at(-1);
    if (!id || id === source.id) return null;
    const bounds = item?.firstElementChild?.getBoundingClientRect();
    const fraction = bounds ? (event.clientY - bounds.top) / Math.max(bounds.height, 1) : 1;
    const inside = fraction > 0.25 && fraction < 0.75 && canDropDesignLayer(document, scene, source.id, id);
    const placement = inside ? 'inside' : fraction < 0.5 ? 'before' : 'after';
    const parentId = inside ? id : scene[id].parentId;
    if (!inside && !canDropDesignLayer(document, scene, source.id, parentId)) return null;
    const order = designLayerOrder(document, parentId);
    const beforeId = placement === 'inside' ? null : beforeIdAtEdge(order, id, placement);
    if (!changesDesignLayerOrder(order.ids, source.id, beforeId)) return null;
    return { id, placement, parentId, beforeId };
  }

  function clearHover() {
    lastHover.current = undefined;
    setHoverDrop(null);
  }

  function resetDrag() {
    drag.current = undefined;
    clearHover();
    preview.end();
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    const source = activeDesignLayerDrag(event.dataTransfer, drag.current, revision);
    if (!source || disabled) return;
    const target = dropTarget(event, source);
    lastHover.current = { source, target, clientX: event.clientX, clientY: event.clientY, scrollTop: event.currentTarget.scrollTop };
    if (target) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
    setHoverDrop((current) => current?.id === target?.id && current?.placement === target?.placement ? current : target);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    const { currentTarget, relatedTarget, clientX, clientY } = event;
    if (!lastHover.current) return;
    if (relatedTarget instanceof Node) {
      if (currentTarget.contains(relatedTarget)) return;
    } else {
      const bounds = currentTarget.getBoundingClientRect();
      if (clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top && clientY < bounds.bottom) return;
    }
    clearHover();
  }

  function dropLayer(event: DragEvent<HTMLDivElement>) {
    const source = activeDesignLayerDrag(event.dataTransfer, drag.current, revision);
    if (!source || disabled || event.dataTransfer.getData(designLayerDragType) !== source.id) return;
    const hover = lastHover.current;
    const target = hover?.source === source ? hover.target : null;
    resetDrag();
    if (!target) return;
    event.preventDefault();
    const pending = { source, target };
    setPendingDrop(pending);
    void onDrop(source.id, target, source.revision).then((applied) => {
      if (applied && target.placement === 'inside') expandLayers([target.id]);
    }).finally(() => {
      setPendingDrop((current) => current === pending ? undefined : current);
    });
  }

  function renderList(parentId: string | null, depth: number, order: LayerOrder, ids: readonly string[]): ReactElement {
    // The source stays mounted outside the flow. Only the receiving list reserves a row.
    const rows = ids.map((id) => renderLayer(id, depth));
    if (slot?.parentId === parentId) {
      const index = slot.beforeId === null ? order.ids.length : order.ids.indexOf(slot.beforeId);
      const visualIndex = order.frontFirst ? order.ids.length - index : index;
      rows.splice(visualIndex, 0, <li key=":drop" className="design-layer__drop-slot" data-design-layer-drop-slot="" aria-hidden="true"
        style={layerDepth(depth)} />);
    }
    return <ul>{rows}</ul>;
  }

  const renderLayer = (id: string, depth: number) => {
    const node = document.nodes[id];
    const resolved = projected.nodes[id] ?? node;
    const hidden = resolved.hidden;
    const { locked } = scene[id];
    const hasChildren = node.kind === 'frame' && node.childIds.length > 0;
    const expanded = expandedLayerIds.has(id);
    const isGroup = node.kind === 'frame' && node.group;
    const isComponent = node.kind === 'frame' && node.component;
    const isInstance = node.kind === 'frame' && node.instanceOf;
    const Icon = isComponent ? Component : isInstance ? Diamond : isGroup ? Group
      : node.kind === 'vector' ? designVectorIcons[node.geometry.kind] : layerIcons[node.kind];
    const Chevron = expanded ? ChevronDown : ChevronRight;
    const Visibility = hidden ? EyeOff : Eye;
    const LockState = locked ? Lock : LockOpen;
    const kindName = isComponent ? 'component' : isInstance ? 'instance' : isGroup ? 'group' : depth === 0 && node.kind === 'frame' ? 'artboard'
      : node.kind === 'vector' ? (designLucideIcon(node.geometry) ? 'icon' : node.geometry.kind) : node.kind;
    const name = node.name || (resolved.kind === 'text' && resolved.text.trim().split('\n', 1)[0]) || t(`feature.design.${kindName}`);
    const recent = id === saved?.board || id === saved?.section;
    const receivesLayer = slot?.id === id && slot.placement === 'inside';
    const order = designLayerOrder(document, id);
    const lifted = movingId === id;
    return <li className="design-layer-item" key={id} data-design-layer-id={id}
      data-reorder-id={lifted ? undefined : id} data-lifted={lifted || undefined} style={layerDepth(depth)}>
      <div className="design-layer" data-selected={selectedIds.includes(id)} data-hidden={hidden || undefined}
        data-drop={receivesLayer ? 'inside' : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch' && !activeDrag) onHoverLayer(id);
        }} onPointerLeave={() => onHoverLayer(undefined)}
        onContextMenu={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.currentTarget.querySelector<HTMLButtonElement>('.design-layer__select')?.focus({ preventScroll: true });
          onContextMenu({ id, point: { x: event.clientX, y: event.clientY } });
        }}>
        {hasChildren ? <IconButton className="design-layer__expand" label={t(expanded ? 'feature.design.collapseLayer' : 'feature.design.expandLayer')}
          aria-expanded={expanded} size="small" onClick={() => toggleLayer(id)}><Chevron size={12} /></IconButton> : null}
        <button ref={id === revealId ? revealRow : undefined} className="design-layer__select" type="button" title={name} aria-label={name}
          aria-description={recent ? t('feature.design.lastSaved') : undefined} aria-pressed={selectedIds.includes(id)} draggable={!disabled && !locked}
          onDragStart={(event) => {
            if (disabled || locked) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(designLayerDragType, id);
            drag.current = { id, revision };
            onHoverLayer(undefined);
            clearHover();
            preview.start(event, event.currentTarget.parentElement ?? event.currentTarget);
          }}
          onDragEnd={resetDrag}
          onKeyDown={(event) => {
            if (disabled || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
            event.preventDefault();
            const { left, bottom } = event.currentTarget.getBoundingClientRect();
            onContextMenu({ id, point: { x: left, y: bottom } });
          }}
          onClick={(event) => onSelect(id, event.shiftKey || event.metaKey || event.ctrlKey)}>
          <Icon aria-hidden="true" />
          {showThumbnails ? <DesignThumbnail id={id} observe={observeThumbnail} /> : null}
          <span className="design-layer__name">{name}</span>
          {recent ? <span aria-hidden="true" title={t('feature.design.lastSaved')}><History size={12} /></span> : null}
        </button>
        <div className="design-layer__actions" data-visible={Boolean(hidden || locked)}>
          <IconButton label={t(hidden ? 'feature.design.showLayer' : 'feature.design.hideLayer')} size="small"
            aria-pressed={!hidden} disabled={disabled} onClick={() => onToggle(id, 'hidden')}><Visibility size={13} /></IconButton>
          <IconButton label={t(locked ? 'feature.design.unlockLayer' : 'feature.design.lockLayer')} size="small"
            aria-pressed={locked} disabled={disabled || (locked && !node.locked)} onClick={() => onToggle(id, 'locked')}><LockState size={13} /></IconButton>
        </div>
      </div>
      {(hasChildren && expanded) || slot?.parentId === id
        ? renderList(id, depth + 1, order, expanded ? displayOrder(order) : []) : null}
    </li>;
  };

  const label = t(chat ? 'feature.design.sidebar' : 'feature.design.layers');
  const title = chat ? <SegmentedControl<'chat' | 'layers'> className="design-panel-navigation" label={label}
    value={view} options={[
      { value: 'chat', label: t('feature.design.chat.tab'), icon: <MessageCircle size={12} aria-hidden="true" /> },
      { value: 'layers', label: t('feature.design.layers'), icon: <Layers size={12} aria-hidden="true" /> },
    ]} onChange={(next) => {
      onHoverLayer(undefined);
      if (next === 'layers') setChatFullscreen(false);
      setView(next);
    }} /> : <h2 className="design-panel__layers-title"><Layers size={12} aria-hidden="true" /><span>{label}</span></h2>;
  const panelAction = showChat ? <IconButton className="design-panel__toggle" size="small" aria-controls={panelId}
    label={t(fullscreen ? 'feature.design.chat.restore' : 'feature.design.chat.maximize')} aria-pressed={fullscreen}
    onClick={() => setChatFullscreen((current) => !current)}>
    {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
  </IconButton> : hasExpandedLayers ? <IconButton size="small" label={t('feature.design.collapseAllLayers')} disabled={reordering}
    onClick={(event) => {
      if (event.detail === 0) list.current?.querySelector<HTMLButtonElement>('.design-layer__expand')?.focus({ preventScroll: true });
      onHoverLayer(undefined);
      collapseAllLayers();
    }}>
    <ChevronsDownUp size={14} />
  </IconButton> : null;
  function togglePanel(event: MouseEvent<HTMLButtonElement>) {
    // Keyboard focus follows the control between the panel header and the canvas edge.
    focusNextToggle.current = event.detail === 0;
    onHoverLayer(undefined);
    onTogglePanel();
  }
  return <>
    {!open && <DesignPanelToggle side="layers" buttonRef={restoreToggleFocus} label={t('feature.design.expandSidebar')}
      aria-expanded={false} aria-controls={panelId} onClick={togglePanel} />}
    <DesignSidePanel side="layers" id={panelId} open={open} label={label} title={title} resizeLabel={t('feature.design.resizeLayers')}
      fullscreen={fullscreen} actions={panelAction} onExitComplete={present ? finishExit : undefined}
      collapse={{ label: t('feature.design.collapseSidebar'), onClick: togglePanel, buttonRef: restoreToggleFocus }}>
      <div className="design-layer-list design-panel-scroll" hidden={showChat} ref={list} data-thumbnails={showThumbnails}
        data-dragging={Boolean(movingId) || undefined} data-scroll-overlay={Boolean(ScrollOverlay) || undefined}
        onDragOver={onDragOver} onDrop={dropLayer} onDragLeave={onDragLeave}>
        {present && !showChat ? renderList(null, 0, rootOrder, roots) : null}
      </div>
      {layersVisible && ScrollOverlay ? <ScrollOverlay scrollRef={list} /> : null}
      {/* Keep drafts and active tasks mounted when switching tabs or collapsing the sidebar. */}
      {chat && <div className="design-layers-chat" hidden={!showChat}>
        <DesignChatPanelContext.Provider value={{ visible: open && showChat, showCanvas: fullscreen ? () => setChatFullscreen(false) : undefined }}>
          <DesignChatFullscreenContext.Provider value={fullscreen}>{chat}</DesignChatFullscreenContext.Provider>
        </DesignChatPanelContext.Provider>
      </div>}
    </DesignSidePanel>
  </>;
}
