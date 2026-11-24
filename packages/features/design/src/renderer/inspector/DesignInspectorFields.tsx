import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentProps, type FocusEvent,
  type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { IconButton, parseNumberExpression, TextArea, TextField } from '@setsuna-desktop/renderer-ui';

export function InspectorSection({ title, children, action }: Readonly<{
  title: string; children?: ReactNode; action?: ReactNode;
}>) {
  return <section className="design-inspector__section">
    <header><h3>{title}</h3>{action}</header>
    {children}
  </section>;
}

export function InspectorGroup({ title, children, action }: Readonly<{ title: string; children: ReactNode; action?: ReactNode }>) {
  return <div className="design-inspector__group">
    <header><h4>{title}</h4>{action}</header>
    {children}
  </div>;
}

export function PaintToggle({ enabled, label, disabled, onToggle }: Readonly<{
  enabled: boolean;
  label: string;
  disabled: boolean;
  onToggle(): void;
}>) {
  return <IconButton label={label} size="small" disabled={disabled} onClick={onToggle}>
    {enabled ? <Minus size={14} /> : <Plus size={14} />}
  </IconButton>;
}

export function VisibilityButton({ visible, label, disabled, onToggle }: Readonly<{
  visible: boolean;
  label: string;
  disabled: boolean;
  onToggle(): void;
}>) {
  return <IconButton label={label} size="small" disabled={disabled} aria-pressed={visible} onClick={onToggle}>
    {visible ? <Eye size={15} /> : <EyeOff size={15} />}
  </IconButton>;
}

export function NumberField({ label, prefix, suffix, value, previewValue, min, max, integer, precision = 2, readOnly, onSave, onPreview }: Readonly<{
  label: string;
  prefix?: ReactNode;
  suffix?: string;
  value: number | undefined;
  previewValue?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  precision?: number;
  readOnly?: boolean;
  onSave(value: number): Promise<boolean>;
  onPreview?(value: number | undefined, owner: string): void;
}>) {
  function parse(text: string) {
    const parsed = Number(text);
    return text.trim() && Number.isFinite(parsed) && (!integer || Number.isInteger(parsed))
      && (min === undefined || parsed >= min) && (max === undefined || parsed <= max) ? parsed : undefined;
  }
  return <InspectorField label={label} prefix={prefix ?? (suffix ? undefined : label)} suffix={suffix}
    value={value === undefined ? '' : String(Number(value.toFixed(precision)))} placeholder={value === undefined ? '—' : undefined}
    previewValue={previewValue === undefined ? undefined : String(Number(previewValue.toFixed(precision)))}
    onDraft={onPreview ? (text, owner) => onPreview(text === undefined ? undefined : parse(text), owner) : undefined}
    type="number" step={integer ? 1 : 'any'} min={min} max={max} readOnly={readOnly} onSave={(text) => {
      const number = parse(text);
      return number === undefined || number === value ? Promise.resolve(false) : onSave(number);
    }} />;
}

type FieldEdit = Readonly<{
  value: string;
  previewValue?: string;
  readOnly?: boolean;
  onSave(value: string): Promise<boolean>;
  onDraft?(value: string | undefined, owner: string): void;
}>;

export function InspectorField({ label, prefix, suffix, trailing, value, previewValue, readOnly, onSave, onDraft, onChange, ...props }:
  Omit<ComponentProps<typeof TextField>, 'value' | 'prefix' | 'onBlur' | 'onKeyDown'> & FieldEdit & {
    label: string; prefix?: ReactNode; suffix?: string; trailing?: ReactNode;
}) {
  const numeric = props.type === 'number' ? { min: Number(props.min ?? -Infinity), max: Number(props.max ?? Infinity) } : undefined;
  const { input, numberDrag } = useInspectorField<HTMLInputElement>({ value, previewValue, readOnly, onSave, onDraft }, numeric);
  const dragPrefix = numeric && value !== '' && !input.readOnly && !props.disabled;
  const displayed = previewValue ?? value;
  const Container = trailing ? 'div' : 'label';
  return <Container className="design-inspector__field" title={label}>
    {prefix ? <span aria-hidden="true" className={dragPrefix ? 'design-inspector__number-drag' : undefined}
      {...(dragPrefix ? numberDrag : undefined)}>{prefix}</span> : null}
    <TextField {...props} {...input} {...(numeric ? {
      type: 'text', role: 'spinbutton', min: undefined, max: undefined, step: undefined, spellCheck: false,
      'aria-valuemin': props.min === undefined ? undefined : numeric.min,
      'aria-valuemax': props.max === undefined ? undefined : numeric.max,
      'aria-valuenow': displayed === '' ? undefined : Number(displayed),
    } : undefined)} aria-label={label} onChange={(event) => { onChange?.(event); input.onChange(event); }} />
    {suffix ? <span aria-hidden="true">{suffix}</span> : null}
    {trailing}
  </Container>;
}

export function InspectorTextArea({ value, previewValue, readOnly, onSave, onDraft, ...props }:
  Omit<ComponentProps<typeof TextArea>, 'value' | 'onBlur' | 'onChange' | 'onKeyDown'> & FieldEdit,
) {
  const { input } = useInspectorField<HTMLTextAreaElement>({ value, previewValue, readOnly, onSave, onDraft });
  return <TextArea {...props} {...input} />;
}

type NumberDrag = {
  pointerId: number;
  startX: number;
  startValue: number;
  changed: boolean;
  release(): void;
};

function useInspectorField<T extends HTMLInputElement | HTMLTextAreaElement>(
  { value, previewValue, readOnly, onSave, onDraft }: FieldEdit,
  numeric?: Readonly<{ min: number; max: number }>,
) {
  const owner = useId();
  const fieldRef = useRef<T>(null);
  const editing = useRef(false);
  const editId = useRef(0);
  const previousValue = useRef(value);
  const clearDraft = useRef<() => void>();
  const drag = useRef<NumberDrag>();
  const [settledEdit, setSettledEdit] = useState(0);
  const fieldReadOnly = readOnly || previewValue !== undefined;
  useLayoutEffect(() => {
    const valueChanged = previousValue.current !== value;
    const canceledDrag = drag.current && (valueChanged || fieldReadOnly);
    if (canceledDrag) {
      drag.current?.release();
      editing.current = false;
    }
    if (!editing.current && (valueChanged || canceledDrag)) {
      // The optimistic model now owns this value, so a draft cannot cover a newer edit.
      clearDraft.current?.();
      clearDraft.current = undefined;
    }
    previousValue.current = value;
    const field = fieldRef.current;
    const displayed = previewValue ?? value;
    if (field && (!editing.current || fieldReadOnly) && field.value !== displayed) field.value = displayed;
  }, [fieldReadOnly, previewValue, settledEdit, value]);
  useEffect(() => () => {
    drag.current?.release();
    clearDraft.current?.();
  }, []);

  function discardPreview() {
    clearDraft.current?.();
    clearDraft.current = undefined;
  }

  function readEditValue(field: T) {
    if (!numeric) return field.value;
    if (!field.value.trim()) return '';
    const result = parseNumberExpression(field.value);
    return result === undefined ? undefined : String(result);
  }

  function previewEdit(field: T) {
    editing.current = true;
    editId.current += 1;
    if (onDraft) {
      clearDraft.current = () => onDraft(undefined, owner);
      onDraft(readEditValue(field), owner);
    }
  }

  function submitEdit(field: T) {
    if (!editing.current) return;
    editing.current = false;
    const nextValue = readEditValue(field);
    if (numeric) field.value = nextValue ?? value;
    if (nextValue === undefined || nextValue === value || fieldReadOnly) { discardPreview(); return; }
    const attempt = editId.current;
    void onSave(nextValue).then(() => {
      if (attempt !== editId.current) return;
      discardPreview();
      if (field.isConnected) setSettledEdit(attempt);
    });
  }

  function finishDrag(field: T, save: boolean) {
    const active = drag.current;
    active?.release();
    if (!active?.changed) return false;
    if (save) submitEdit(field);
    else {
      editing.current = false;
      field.value = value;
      discardPreview();
    }
    return true;
  }

  function dragNumber(event: PointerEvent<HTMLSpanElement>) {
    const active = drag.current;
    const field = fieldRef.current;
    if (!numeric || !active || active.pointerId !== event.pointerId || !field) return;
    const delta = Math.round(event.clientX - active.startX);
    if (!active.changed && Math.abs(delta) < 2) return;
    const next = String(Math.min(numeric.max, Math.max(numeric.min, Number((active.startValue + delta).toFixed(2)))));
    if (next === field.value) return;
    active.changed = true;
    field.value = next;
    previewEdit(field);
  }

  function endNumberDrag(event: PointerEvent<HTMLSpanElement>, save: boolean) {
    const field = fieldRef.current;
    if (!field || drag.current?.pointerId !== event.pointerId) return;
    // Release can arrive before the last pointer move is delivered.
    if (save) dragNumber(event);
    finishDrag(field, save);
  }

  function startNumberDrag(event: PointerEvent<HTMLSpanElement>) {
    const field = fieldRef.current;
    if (!numeric || event.button !== 0 || drag.current || fieldReadOnly || !field || field.matches(':disabled')) return;
    const startValue = parseNumberExpression(field.value);
    if (startValue === undefined) return;
    event.preventDefault();
    const { currentTarget: handle, pointerId, clientX: startX } = event;
    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // The platform can cancel the pointer before it is captured.
      return;
    }
    const view = handle.ownerDocument.defaultView;
    const cancel = () => { finishDrag(field, false); };
    drag.current = {
      pointerId, startX, startValue, changed: false,
      release() {
        drag.current = undefined;
        view?.removeEventListener('blur', cancel);
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      },
    };
    view?.addEventListener('blur', cancel);
    field.focus({ preventScroll: true });
  }

  const input = {
    ref: fieldRef,
    defaultValue: value,
    readOnly: fieldReadOnly,
    onChange: (event: ChangeEvent<T>) => previewEdit(event.currentTarget),
    onBlur(event: FocusEvent<T>) {
      if (!finishDrag(event.currentTarget, false)) submitEdit(event.currentTarget);
    },
    onKeyDown(event: KeyboardEvent<T>) {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (numeric && !fieldReadOnly && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const field = event.currentTarget;
        const value = readEditValue(field);
        if (value === undefined) return;
        event.preventDefault();
        const next = Number(value) + (event.key === 'ArrowUp' ? 1 : -1);
        field.value = String(Math.min(numeric.max, Math.max(numeric.min, next)));
        previewEdit(field);
        return;
      }
      if (event.key === 'Escape') {
        finishDrag(event.currentTarget, false);
        event.currentTarget.value = value;
      }
      const enter = event.key === 'Enter'
        && (event.currentTarget.tagName === 'INPUT' || event.metaKey || event.ctrlKey);
      if (event.key === 'Escape' || enter) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
  const numberDrag = {
    onPointerDown: startNumberDrag,
    onPointerMove: dragNumber,
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => endNumberDrag(event, true),
    onPointerCancel: (event: PointerEvent<HTMLSpanElement>) => endNumberDrag(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLSpanElement>) => endNumberDrag(event, false),
  };
  return { input, numberDrag };
}

export const designInspectorPopoverPosition = {
  placement: 'leftTop',
  sideOffset: 6,
  getAnchorRect(trigger: HTMLElement) {
    const row = trigger.getBoundingClientRect();
    const panel = trigger.closest('.design-editor__inspector, .sd-popover')?.getBoundingClientRect();
    // Line up with the control vertically and clear the panel that contains it.
    return panel ? new DOMRect(panel.left, row.top, panel.width, row.height) : row;
  },
} as const;
