import {
  ChevronDown, ChevronRight, Circle, Component, Diamond, Eye, EyeOff, Frame, Group,
  ImageIcon, Lock, LockOpen, PanelLeftClose, PanelLeftOpen, Square, Type,
} from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MutableRefObject, type ReactElement } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, useNativeDragPreview, useReorderLayout } from '@setsuna-desktop/renderer-ui';
import type { DesignDocument } from '../contracts/index.js';
import type { DesignLayerMenuTarget } from './context/use-design-layer-actions.js';
import { activeDesignLayerDrag, canDropDesignLayer, changesDesignLayerOrder, designLayerDragType, designLayerOrder,
  type DesignLayerDestination, type DesignLayerDrag } from './design-layer-drop.js';
import type { DesignScene } from './design-layout.js';
import { designVectorIcons } from './vectors/design-vector-icons.js';
import { designLucideIcon } from './vectors/design-vector.js';

const layerIcons = { frame: Frame, image: ImageIcon, rectangle: Square, ellipse: Circle, text: Type };

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

function layerIndent(depth: number): CSSProperties {
  return { '--design-layer-indent': `${Math.min(depth, 8) * 9}px` } as CSSProperties;
}

export function DesignLayers({
  document, scene, revision, drag, selectedIds, open, disabled, onTogglePanel, onSelect, onToggle, onDrop, onContextMenu, translate: t,
}: Readonly<{
  document: DesignDocument;
  scene: DesignScene;
  revision: string;
  drag: MutableRefObject<DesignLayerDrag | undefined>;
  selectedIds: readonly string[];
  open: boolean;
  disabled: boolean;
  onTogglePanel(): void;
  onSelect(id: string, additive: boolean): void;
  onToggle(id: string, flag: 'locked' | 'hidden'): void;
  onDrop(id: string, destination: DesignLayerDestination, expectedRevision: string): Promise<boolean>;
  onContextMenu(target: DesignLayerMenuTarget): void;
  translate: RendererTranslate;
}>) {
  const panelId = useId();
  const list = useRef<HTMLDivElement>(null);
  const panelHeight = useRef(0);
  const lastHover = useRef<LayerHover>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [hoverDrop, setHoverDrop] = useState<LayerDrop | null>(null);
  const [pendingDrop, setPendingDrop] = useState<Readonly<{ source: DesignLayerDrag; target: LayerDrop }>>();
  const [confirmedDrag, setConfirmedDrag] = useState<DesignLayerDrag>();
  const preview = useNativeDragPreview({ anchor: 'source', liveWithin: list });
  const activeDrag = preview.dragging && open && !disabled && drag.current?.revision === revision ? drag.current : undefined;
  const saving = open && pendingDrop?.source.revision === revision ? pendingDrop : undefined;
  const liftedId = activeDrag === confirmedDrag ? activeDrag?.id : undefined;
  const slot = (liftedId ? hoverDrop : null) ?? saving?.target;
  const movingId = liftedId ?? saving?.source.id;
  const rootOrder = designLayerOrder(document, null);
  const roots = displayOrder(rootOrder);
  const layoutKey = movingId ? JSON.stringify([revision, movingId, slot?.parentId, slot?.beforeId]) : revision;
  useReorderLayout(list, layoutKey, Boolean(activeDrag || saving));

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
      if (applied && target.placement === 'inside') setCollapsed((current) => {
        if (!current.has(target.id)) return current;
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
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
        style={layerIndent(depth)} />);
    }
    return <ul>{rows}</ul>;
  }

  const renderLayer = (id: string, depth: number) => {
    const node = document.nodes[id];
    const { locked } = scene[id];
    const children = node.kind === 'frame' ? node.childIds : [];
    const expanded = !collapsed.has(id);
    const isGroup = node.kind === 'frame' && node.group;
    const isComponent = node.kind === 'frame' && node.component;
    const isInstance = node.kind === 'frame' && node.instanceOf;
    const Icon = isComponent ? Component : isInstance ? Diamond : isGroup ? Group
      : node.kind === 'vector' ? designVectorIcons[node.geometry.kind] : layerIcons[node.kind];
    const Chevron = expanded ? ChevronDown : ChevronRight;
    const Visibility = node.hidden ? EyeOff : Eye;
    const LockState = locked ? Lock : LockOpen;
    const kindName = isComponent ? 'component' : isInstance ? 'instance' : isGroup ? 'group' : depth === 0 && node.kind === 'frame' ? 'artboard'
      : node.kind === 'vector' ? (designLucideIcon(node.geometry) ? 'icon' : node.geometry.kind) : node.kind;
    const name = node.name || (node.kind === 'text' && node.text.trim().split('\n', 1)[0]) || t(`feature.design.${kindName}`);
    const receivesLayer = slot?.id === id && slot.placement === 'inside';
    const order = designLayerOrder(document, id);
    const lifted = movingId === id;
    return <li className="design-layer-item" key={id} data-design-layer-id={id}
      data-reorder-id={lifted ? undefined : id} data-lifted={lifted || undefined} style={layerIndent(depth)}>
      <div className="design-layer" data-selected={selectedIds.includes(id)} data-hidden={node.hidden || undefined}
        data-drop={receivesLayer ? 'inside' : undefined}
        onContextMenu={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.currentTarget.querySelector<HTMLButtonElement>('.design-layer__select')?.focus({ preventScroll: true });
          onContextMenu({ id, point: { x: event.clientX, y: event.clientY } });
        }}>
        {children.length ? <IconButton className="design-layer__expand" label={t(expanded ? 'feature.design.collapseLayer' : 'feature.design.expandLayer')}
          aria-expanded={expanded} size="small" onClick={() => {
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}><Chevron size={12} /></IconButton> : null}
        <button className="design-layer__select" type="button" title={name} aria-pressed={selectedIds.includes(id)} draggable={!disabled && !locked}
          onDragStart={(event) => {
            if (disabled || locked) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(designLayerDragType, id);
            drag.current = { id, revision };
            // Keep the panel's blank drop area available after its source row is lifted.
            panelHeight.current = list.current?.parentElement?.offsetHeight ?? 0;
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
          <Icon size={14} aria-hidden="true" />
          <span>{name}</span>
        </button>
        <div className="design-layer__actions" data-visible={Boolean(node.hidden || locked)}>
          <IconButton label={t(node.hidden ? 'feature.design.showLayer' : 'feature.design.hideLayer')} size="small"
            aria-pressed={!node.hidden} disabled={disabled} onClick={() => onToggle(id, 'hidden')}><Visibility size={13} /></IconButton>
          <IconButton label={t(locked ? 'feature.design.unlockLayer' : 'feature.design.lockLayer')} size="small"
            aria-pressed={locked} disabled={disabled || (locked && !node.locked)} onClick={() => onToggle(id, 'locked')}><LockState size={13} /></IconButton>
        </div>
      </div>
      {(children.length && expanded) || slot?.parentId === id
        ? renderList(id, depth + 1, order, expanded ? displayOrder(order) : []) : null}
    </li>;
  };

  const PanelToggle = open ? PanelLeftClose : PanelLeftOpen;
  return <aside className="design-editor__layers" aria-label={t('feature.design.layers')}
    style={movingId && panelHeight.current ? { height: panelHeight.current } : undefined}>
    <header className="design-panel__header">
      {open ? <h2>{t('feature.design.layers')}</h2> : null}
      <IconButton className="design-panel__toggle" label={t('feature.design.layers')} size="small"
        aria-expanded={open} aria-controls={panelId} onClick={onTogglePanel}><PanelToggle size={15} /></IconButton>
    </header>
    <div className="design-layer-list" id={panelId} ref={list} hidden={!open} data-dragging={Boolean(movingId) || undefined}
      onDragOver={onDragOver} onDrop={dropLayer} onDragLeave={onDragLeave}>
      {open ? renderList(null, 0, rootOrder, roots) : null}
    </div>
  </aside>;
}
