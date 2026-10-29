import type { CSSProperties } from 'react';
import { Button } from '../button.js';
import { Tooltip } from '../popover.js';
import { ICON_COLORS, iconColorCssValue, normalizeIconColor, type IconColor } from './colors.js';

export function IconColorPicker({ value, label, colorLabel, textColorLabel, disabled = false, onChange }: Readonly<{
  value?: string;
  label: string;
  colorLabel(color: IconColor): string;
  textColorLabel: string;
  disabled?: boolean;
  onChange(color: IconColor): void;
}>) {
  const selectedColor = normalizeIconColor(value);
  return (
    <span className="icon-color-picker" role="group" aria-label={label}>
      {ICON_COLORS.map((color) => (
        <Tooltip key={color} title={color === 'text' ? textColorLabel : color}>
          <Button type="button" variant="ghost" className="icon-color-picker__swatch"
            disabled={disabled} aria-label={color === 'text' ? textColorLabel : colorLabel(color)} aria-pressed={selectedColor === color}
            style={{ '--icon-swatch-color': iconColorCssValue(color) } as CSSProperties} onClick={() => onChange(color)} />
        </Tooltip>
      ))}
    </span>
  );
}
