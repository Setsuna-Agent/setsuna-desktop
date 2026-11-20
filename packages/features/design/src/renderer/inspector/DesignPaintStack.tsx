import { GripVertical } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { IconButton, useDragReorderPreview, useNativeDragPreview } from '@setsuna-desktop/renderer-ui';

const paintDragType = 'application/x-setsuna-design-paint';
type DragSource<T> = Readonly<{ entries: readonly T[]; from: number }>;
type Placement<T> = DragSource<T> & Readonly<{ to: number }>;

function movePaint<T>({ entries, from, to }: Placement<T>): readonly T[] {
  const next = [...entries];
  const [paint] = next.splice(from, 1);
  next.splice(to, 0, paint);
  return next;
}

function dropIndex(list: HTMLDivElement, clientY: number, from: number) {
  // Measure the original slots so animated rows cannot change the target under a stationary pointer.
  const bounds = list.getBoundingClientRect();
  const scale = list.offsetHeight ? bounds.height / list.offsetHeight : 1;
  let index = list.children.length - 1;
  for (const row of Array.from(list.children)) {
    if (!(row instanceof HTMLElement) || row.dataset.reorderId === String(from)) continue;
    if (clientY >= bounds.top + (row.offsetTop + row.offsetHeight / 2) * scale) index -= 1;
  }
  return index;
}

export function DesignPaintStack<T>({ entries, label, disabled, renderEntry, onSave, onPreview }: Readonly<{
  entries: readonly T[];
  label: string;
  disabled: boolean;
  renderEntry(value: T, index: number): ReactNode;
  onSave(values: readonly T[]): Promise<boolean>;
  onPreview(values: readonly T[] | undefined): void;
}>) {
  const list = useRef<HTMLDivElement>(null);
  const source = useRef<DragSource<T>>();
  const restoreFocus = useRef<number>();
  const native = useNativeDragPreview();
  const [hover, setHover] = useState<Placement<T>>();
  const [pending, setPending] = useState<Placement<T>>();
  const orderKey = useMemo(() => JSON.stringify(entries), [entries]);
  const rows = entries.map((value, index) => ({ value, index }));
  const active = !disabled && native.dragging && hover?.entries === entries ? hover : undefined;
  const preview = active ?? (pending?.entries === entries ? pending : undefined);
  const before = preview && rows.filter(({ index }) => index !== preview.from)[preview.to - 1];
  useDragReorderPreview(list, {
    draggedId: preview ? String(preview.from) : null, beforeId: before ? String(before.index) : null, orderKey,
  });
  useLayoutEffect(() => {
    if (!preview || preview.from === preview.to) return;
    onPreview(movePaint(preview));
    return () => onPreview(undefined);
  }, [preview, onPreview]);
  useLayoutEffect(() => {
    if (disabled || pending || restoreFocus.current === undefined) return;
    const root = list.current;
    const owner = root?.ownerDocument;
    if (root && owner && (owner.activeElement === owner.body || root.contains(owner.activeElement))) {
      const row = root.querySelector(`[data-reorder-id="${restoreFocus.current}"]`);
      row?.querySelector<HTMLButtonElement>('.design-inspector__paint-handle')?.focus({ preventScroll: true });
    }
    restoreFocus.current = undefined;
  }, [disabled, entries, pending]);

  function activeSource(event: DragEvent<HTMLDivElement>) {
    const current = source.current;
    return native.dragging && !disabled && !pending && current?.entries === entries && event.dataTransfer.types.includes(paintDragType)
      ? current : undefined;
  }

  function endDrag() {
    source.current = undefined;
    setHover(undefined);
    native.end();
  }

  async function save(placement: Placement<T>, focusMoved = false) {
    if (placement.from === placement.to) return;
    setPending(placement);
    try {
      if (await onSave(movePaint(placement)) && focusMoved) restoreFocus.current = placement.to;
    } finally {
      setPending(undefined);
    }
  }

  if (!rows.length) return null;
  return <div className="design-inspector__paint-stack" ref={list} onDragOver={(event) => {
    const current = activeSource(event);
    if (!current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const to = dropIndex(event.currentTarget, event.clientY, current.from);
    setHover((previous) => previous?.entries === entries && previous.from === current.from && previous.to === to
      ? previous : { ...current, to });
  }} onDragLeave={(event) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
    if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) setHover(undefined);
  }} onDrop={(event) => {
    const current = activeSource(event);
    if (!current) return;
    event.preventDefault();
    const to = dropIndex(event.currentTarget, event.clientY, current.from);
    const matches = event.dataTransfer.getData(paintDragType) === String(current.from);
    endDrag();
    if (matches) void save({ ...current, to });
  }}>
    {/* The foremost paint appears first in the inspector. The document paints back to front. */}
    {rows.reverse().map(({ value, index }) => <div className="design-inspector__paint-entry" key={index}
      data-reorder-id={index} data-dragging={active?.from === index || undefined}>
      {rows.length > 1 ? <IconButton size="small" className="design-inspector__paint-handle" label={label}
        disabled={disabled || Boolean(pending)} draggable={!disabled && !pending} aria-keyshortcuts="ArrowUp ArrowDown"
        onDragStart={(event) => {
          if (disabled || pending) { event.preventDefault(); return; }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(paintDragType, String(index));
          source.current = { entries, from: index };
          const field = event.currentTarget.parentElement?.querySelector<HTMLElement>('.design-paint-field');
          native.start(event, field ?? event.currentTarget);
        }} onDragEnd={endDrag} onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.stopPropagation();
          const to = index + (event.key === 'ArrowUp' ? 1 : -1);
          if (!disabled && !pending && to >= 0 && to < entries.length) void save({ entries, from: index, to }, true);
        }}><GripVertical size={14} /></IconButton> : null}
      <div className="design-inspector__paint-entry-body">{renderEntry(value, index)}</div>
    </div>)}
  </div>;
}
