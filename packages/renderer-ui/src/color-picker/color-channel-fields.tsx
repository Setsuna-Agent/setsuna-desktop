import { useState, type ReactNode } from 'react';
import { useUiLabels } from '../locale.js';
import { SelectField } from '../select.js';
import { TextField } from '../fields.js';
import { hexToHsv, type Hsv } from './color.js';

type Format = 'hex' | 'rgb' | 'hsl';

export function ColorChannelFields({ hex, color, opacity, disabled, leading, onChange }: Readonly<{
  hex: string; color: Hsv; opacity?: number; disabled: boolean; leading: ReactNode; onChange(paint: Partial<Hsv> & { opacity?: number }): void;
}>) {
  const [format, setFormat] = useState<Format>('hex');
  const labels = useUiLabels().colorPicker;
  const alpha = opacity === undefined ? null : <Channel label="A" value={String(Number(opacity.toFixed(2)))} disabled={disabled}
    onChange={(value) => {
      if (value.trim() && Number(value) >= 0 && Number(value) <= 1) onChange({ opacity: Number(value) });
    }} />;
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const lightness = color.v * (1 - color.s / 200);
  const hsl = [color.h, lightness <= 0 || lightness >= 100 ? 0 : (color.v - lightness) * 100 / Math.min(lightness, 100 - lightness), lightness];
  function applyChannel(index: number, value: string) {
    const channel = Number(value);
    const limit = format === 'rgb' ? 255 : index === 0 ? 360 : 100;
    if (!value.trim() || !Number.isFinite(channel) || channel < 0 || channel > limit) return;
    if (format === 'rgb') {
      rgb[index] = Math.round(channel);
      onChange(hexToHsv(`#${rgb.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`, color));
      return;
    }
    hsl[index] = channel;
    const [h, s, l] = hsl;
    const v = l + s / 100 * Math.min(l, 100 - l);
    onChange({ h, s: v === 0 ? 0 : 200 * (1 - l / v), v });
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
      {format === 'hex' ? <Channel label="HEX" value={hex.slice(1).toUpperCase()} disabled={disabled} onChange={(value) => {
        const digits = value.trim().replace(/^#/u, '');
        if (/^[\da-f]{6}$/iu.test(digits)) onChange(hexToHsv(`#${digits}`, color));
        else if (opacity !== undefined && /^[\da-f]{8}$/iu.test(digits)) {
          onChange({ ...hexToHsv(`#${digits.slice(0, 6)}`, color), opacity: Number.parseInt(digits.slice(6), 16) / 255 });
        }
      }} /> : (format === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'L']).map((label, index) =>
        <Channel key={label} label={label} value={String(Math.round((format === 'rgb' ? rgb : hsl)[index]))} disabled={disabled}
          onChange={(value) => applyChannel(index, value)} />)}
      {alpha}
    </div>
  </div>;
}

function Channel({ label, value, disabled, onChange }: Readonly<{
  label: string; value: string; disabled: boolean; onChange(value: string): void;
}>) {
  const [draft, setDraft] = useState<string>();
  return <label className="sd-color-picker__value" title={label}>
    <span aria-hidden="true">{label === 'HEX' ? '#' : label}</span>
    <TextField aria-label={label} value={draft ?? value} disabled={disabled} spellCheck={false} onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => {
        setDraft(undefined);
        if (event.currentTarget.value !== value) onChange(event.currentTarget.value);
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.value = value;
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }} />
  </label>;
}
