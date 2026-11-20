import { useRef, useState, type ReactNode } from 'react';
import { useUiLabels } from '../locale.js';
import { parseNumberExpression } from '../fields/number-expression.js';
import { SelectField } from '../select.js';
import { TextField } from '../fields.js';
import { hexToHsv, type Hsv } from './color.js';

type Format = 'hex' | 'rgb' | 'hsl';
type ColorPatch = Partial<Hsv> & { opacity?: number };
type ChannelEdit = Readonly<{ onUpdate(paint: ColorPatch, commit: boolean): void; onCancel(): void }>;

export function ColorChannelFields({ hex, color, opacity, disabled, leading, onUpdate, onCancel }: ChannelEdit & Readonly<{
  hex: string; color: Hsv; opacity?: number; disabled: boolean; leading: ReactNode;
}>) {
  const [format, setFormat] = useState<Format>('hex');
  const labels = useUiLabels().colorPicker;
  const edit = { disabled, onUpdate, onCancel };
  const alpha = opacity === undefined ? null : <Channel {...edit} label="A" value={String(Number(opacity.toFixed(2)))}
    parse={(value) => {
      const opacity = parseNumberExpression(value);
      return opacity !== undefined && opacity >= 0 && opacity <= 1 ? { opacity } : undefined;
    }} />;
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const lightness = color.v * (1 - color.s / 200);
  const hsl = [color.h, lightness <= 0 || lightness >= 100 ? 0 : (color.v - lightness) * 100 / Math.min(lightness, 100 - lightness), lightness];
  function parseChannel(index: number, value: string) {
    const channel = parseNumberExpression(value);
    const limit = format === 'rgb' ? 255 : index === 0 ? 360 : 100;
    if (channel === undefined || channel < 0 || channel > limit) return;
    if (format === 'rgb') {
      const hex = rgb.map((byte, at) => (at === index ? Math.round(channel) : byte).toString(16).padStart(2, '0')).join('');
      return hexToHsv(`#${hex}`, color);
    }
    const [h, s, l] = hsl.map((item, at) => at === index ? channel : item);
    const v = l + s / 100 * Math.min(l, 100 - l);
    return { h, s: v === 0 ? 0 : 200 * (1 - l / v), v };
  }

  return <div className="sd-color-picker__numbers" data-format={format}>
    <div className="sd-color-picker__formats">
      {leading}
      <SelectField aria-label={labels.format} value={format} disabled={disabled} onValueChange={(next) => {
        if (next === 'hex' || next === 'rgb' || next === 'hsl') setFormat(next);
      }}>
        <option value="hex">HEX</option>
        <option value="rgb">{alpha ? 'RGBA' : 'RGB'}</option>
        <option value="hsl">{alpha ? 'HSLA' : 'HSL'}</option>
      </SelectField>
    </div>
    <div className="sd-color-picker__values">
      {format === 'hex' ? <Channel {...edit} label="HEX" value={hex.slice(1).toUpperCase()} parse={(value) => {
        const digits = value.trim().replace(/^#/u, '');
        if (/^[\da-f]{6}$/iu.test(digits)) return { ...hexToHsv(`#${digits}`, color), opacity };
        if (opacity !== undefined && /^[\da-f]{8}$/iu.test(digits)) {
          return { ...hexToHsv(`#${digits.slice(0, 6)}`, color), opacity: Number.parseInt(digits.slice(6), 16) / 255 };
        }
      }} /> : (format === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'L']).map((label, index) =>
        <Channel {...edit} key={label} label={label} value={String(Math.round((format === 'rgb' ? rgb : hsl)[index]))}
          parse={(value) => parseChannel(index, value)} />)}
      {alpha}
    </div>
  </div>;
}

function Channel({ label, value, disabled, parse, onUpdate, onCancel }: ChannelEdit & Readonly<{
  label: string; value: string; disabled: boolean; parse(value: string): ColorPatch | undefined;
}>) {
  const [draft, setDraft] = useState<string>();
  const start = useRef<{ value: string; parse: typeof parse }>();
  return <label className="sd-color-picker__value" title={label}>
    <span aria-hidden="true">{label === 'HEX' ? '#' : label}</span>
    <TextField aria-label={label} value={draft ?? value} disabled={disabled} spellCheck={false}
      onChange={(event) => {
        const text = event.currentTarget.value;
        // Keep the other channels from the start of this edit, including at HSL extremes.
        const initial = start.current ??= { value, parse };
        setDraft(text);
        const patch = initial.parse(text);
        if (patch) onUpdate(patch, false);
        else onCancel();
      }} onBlur={(event) => {
        const initial = start.current;
        start.current = undefined;
        setDraft(undefined);
        if (!initial) return;
        const text = event.currentTarget.value;
        const patch = text === initial.value ? undefined : initial.parse(text);
        if (patch) onUpdate(patch, true);
        else onCancel();
      }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          start.current = undefined;
          onCancel();
        }
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }} />
  </label>;
}
