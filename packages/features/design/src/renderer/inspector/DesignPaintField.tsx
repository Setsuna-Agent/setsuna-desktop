import { useState, type ReactNode } from 'react';
import { ColorPicker, ColorPickerSwatch, type PickerColor } from '@setsuna-desktop/renderer-ui';
import { designColorWithAlpha, splitDesignColor } from '../../contracts/design-color.js';
import { designInspectorPopoverPosition, InspectorField } from './DesignInspectorFields.js';
import './design-paint-field.css';

type PaintFieldProps = Readonly<{
  label: string;
  value: string;
  displayName?: string;
  disabled: boolean;
  mixed?: boolean;
  preview?: string;
  swatch: ReactNode;
  link?: ReactNode;
  opacityField?: ReactNode;
  onSave(value: string): Promise<boolean>;
  onDraft?(value: string | undefined, owner: string): void;
}>;

export function PaintField({ label, value, displayName, disabled, mixed, preview, swatch, link, opacityField, onSave, onDraft }: PaintFieldProps) {
  function parse(input: string) {
    const hex = input.replace(/^#/u, '');
    return /^[0-9a-f]{6}$/iu.test(hex) ? designColorWithAlpha(`#${hex}`, splitDesignColor(value).opacity) : undefined;
  }
  return <div className="design-paint-field">
    <div className="design-paint-field__color">
      {swatch}
      {displayName !== undefined ? <span className="design-paint-field__name" title={displayName}>{displayName}</span>
        : <InspectorField label={label} value={mixed ? '' : value.slice(1, 7).toUpperCase()} placeholder={mixed ? '—' : undefined}
          previewValue={preview?.slice(1, 7).toUpperCase()} readOnly={disabled} maxLength={7} spellCheck={false}
          onDraft={onDraft ? (input, owner) => onDraft(input === undefined ? undefined : parse(input), owner) : undefined} onSave={(input) => {
            const color = parse(input);
            return color === undefined ? Promise.resolve(false) : onSave(color);
          }} />}
      {link}
    </div>
    {opacityField ? <div className="design-paint-field__opacity">{opacityField}</div> : null}
  </div>;
}

// This picker edits the alpha encoded in the color. Paint rows supply their own swatch when opacity is a separate property.
export function ColorField({ editOpacity = false, onPreview, ...field }: Omit<PaintFieldProps, 'swatch' | 'preview' | 'onDraft'> & Readonly<{
  editOpacity?: boolean;
  onPreview(color: string | undefined): void;
}>) {
  const { label, value, displayName, mixed, disabled, onSave } = field;
  const [preview, setPreview] = useState<{ source: string; color: string; typed: boolean }>();
  const active = preview?.source === value ? preview : undefined;
  const { color, opacity } = splitDesignColor(value);

  function publish(color: string | undefined, typed = false) {
    setPreview(color === undefined ? undefined : { source: value, color, typed });
    onPreview(color);
  }

  const encode = (paint: PickerColor) => designColorWithAlpha(paint.color, paint.opacity ?? 1);
  const channels = editOpacity || opacity < 1
    ? { opacity, onColorPreview: (paint: PickerColor | undefined) => publish(paint && encode(paint)),
      onColorCommit: (paint: PickerColor) => onSave(encode(paint)) }
    : { onValuePreview: publish, onValueCommit: onSave };
  const swatch = displayName !== undefined ? <ReadOnlyPaintSwatch value={value} />
    : <ColorPicker label={label} value={active?.typed ? active.color.slice(0, 7) : color} mixed={mixed && !active?.typed}
      disabled={disabled} {...designInspectorPopoverPosition} {...channels} />;
  return <PaintField {...field} swatch={swatch} preview={active?.typed ? undefined : active?.color}
    onDraft={(color) => publish(color, true)} />;
}

export function ReadOnlyPaintSwatch({ value, opacity = 1 }: Readonly<{ value: string; opacity?: number }>) {
  const paint = splitDesignColor(value);
  return <span className="sd-color-picker__trigger design-paint-field__swatch" aria-hidden="true">
    <ColorPickerSwatch color={paint.color} opacity={paint.opacity * opacity} />
  </span>;
}
