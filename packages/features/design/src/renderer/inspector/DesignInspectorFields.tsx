import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ColorPicker, IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import type { DesignQuad } from '../../contracts/index.js';

export function InspectorSection({ title, children, action }: Readonly<{
  title: string; children?: ReactNode; action?: ReactNode;
}>) {
  return <section className="design-inspector__section">
    <header><h3>{title}</h3>{action}</header>
    {children}
  </section>;
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

export function QuadFields({ values, labels, prefixes, onSave }: Readonly<{
  values: DesignQuad;
  labels: readonly [string, string, string, string];
  prefixes: readonly [ReactNode, ReactNode, ReactNode, ReactNode];
  onSave(values: DesignQuad): Promise<boolean>;
}>) {
  return <div className="design-inspector__pair">
    {values.map((value, index) => <NumberField key={index} label={labels[index]} prefix={prefixes[index]}
      value={value} min={0} onSave={(next) => {
        const measurements: [number, number, number, number] = [...values];
        measurements[index] = next;
        return onSave(measurements);
      }} />)}
  </div>;
}

export function NumberField({ label, prefix, suffix, value, previewValue, min, max, readOnly, onSave, onPreview }: Readonly<{
  label: string;
  prefix?: ReactNode;
  suffix?: string;
  value: number | undefined;
  previewValue?: number;
  min?: number;
  max?: number;
  readOnly?: boolean;
  onSave(value: number): Promise<boolean>;
  onPreview?(value: number | undefined, owner: string): void;
}>) {
  const id = useId();
  function parse(text: string) {
    const number = Number(text);
    return text.trim() && Number.isFinite(number) && (min === undefined || number >= min) && (max === undefined || number <= max)
      ? number : undefined;
  }
  return <InspectorField label={label} prefix={prefix ?? (suffix ? undefined : label)} suffix={suffix}
    value={value === undefined ? '' : String(Number(value.toFixed(2)))} placeholder={value === undefined ? '—' : undefined}
    previewValue={previewValue === undefined ? undefined : String(Number(previewValue.toFixed(2)))}
    onDraft={onPreview ? (text) => onPreview(text === undefined ? undefined : parse(text), id) : undefined}
    type="number" step="any" min={min} max={max} readOnly={readOnly} onSave={(text) => {
      const number = parse(text);
      return number === undefined || number === value ? Promise.resolve(false) : onSave(number);
    }} />;
}

export function InspectorField({ label, prefix, suffix, value, previewValue, readOnly, onSave, onDraft, onChange, ...props }: Omit<ComponentProps<typeof TextField>, 'value' | 'prefix' | 'onBlur' | 'onKeyDown'> & {
  label: string;
  prefix?: ReactNode;
  suffix?: string;
  value: string;
  previewValue?: string;
  onSave(value: string): Promise<boolean>;
  onDraft?(value: string | undefined): void;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const editId = useRef(0);
  const clearDraft = useRef<() => void>();
  const [settledEdit, setSettledEdit] = useState(0);
  const fieldReadOnly = readOnly || previewValue !== undefined;
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const displayed = previewValue ?? value;
    if (field && (!editing.current || fieldReadOnly) && field.value !== displayed) field.value = displayed;
  }, [fieldReadOnly, previewValue, settledEdit, value]);
  useEffect(() => () => clearDraft.current?.(), []);

  return <label className="design-inspector__field" title={label}>
    {prefix ? <span aria-hidden="true">{prefix}</span> : null}
    <TextField {...props} ref={fieldRef} aria-label={label} defaultValue={value} readOnly={fieldReadOnly} onChange={(event) => {
      onChange?.(event);
      editing.current = true;
      editId.current += 1;
      if (onDraft) {
        clearDraft.current = () => onDraft(undefined);
        onDraft(event.currentTarget.value);
      }
    }} onBlur={(event) => {
      const field = event.currentTarget;
      if (!editing.current) return;
      editing.current = false;
      function discardPreview() {
        clearDraft.current?.();
        clearDraft.current = undefined;
      }
      if (field.value === value || fieldReadOnly) { discardPreview(); return; }
      const attempt = editId.current;
      void onSave(field.value).then(() => {
        if (attempt !== editId.current) return;
        discardPreview();
        if (field.isConnected) setSettledEdit(attempt);
      });
    }} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') event.currentTarget.value = value;
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }} />
    {suffix ? <span aria-hidden="true">{suffix}</span> : null}
  </label>;
}

export const designPaintPopoverPosition = {
  placement: 'leftTop',
  sideOffset: 6,
  getAnchorRect(trigger: HTMLElement) {
    const row = trigger.getBoundingClientRect();
    const panel = trigger.closest('.design-editor__inspector')?.getBoundingClientRect();
    // Keep the swatch's vertical position and clear the panel on either side.
    return panel ? new DOMRect(panel.left, row.top, panel.width, row.height) : row;
  },
} as const;

export function PaintField({ label, value, mixed = false, disabled, onPreview, onSave }: Readonly<{
  label: string;
  value: string;
  mixed?: boolean;
  disabled: boolean;
  onPreview(color: string | undefined): void;
  onSave(value: string): Promise<boolean>;
}>) {
  const [preview, setPreview] = useState<{ source: string; color: string }>();
  const previewColor = preview?.source === value ? preview.color : undefined;
  return <>
    <ColorPicker label={label} value={value} mixed={mixed} disabled={disabled} {...designPaintPopoverPosition}
      onValuePreview={(color) => {
        setPreview(color === undefined ? undefined : { source: value, color });
        onPreview(color);
      }} onValueCommit={onSave} />
    <PaintHexField label={label} value={value} mixed={mixed} preview={previewColor} disabled={disabled} onSave={onSave} />
  </>;
}

export function PaintHexField({ label, value, mixed, preview, disabled, onSave }: Readonly<{
  label: string; value: string; mixed?: boolean; preview?: string; disabled: boolean; onSave(value: string): Promise<boolean>;
}>) {
  return <InspectorField label={label} value={mixed ? '' : value.slice(1).toUpperCase()} placeholder={mixed ? '—' : undefined} readOnly={disabled}
    previewValue={preview?.slice(1).toUpperCase()} maxLength={7} spellCheck={false} onSave={(next) => {
      const hex = next.replace(/^#/u, '');
      return /^[0-9a-f]{6}$/iu.test(hex) ? onSave(`#${hex}`) : Promise.resolve(false);
    }} />;
}
