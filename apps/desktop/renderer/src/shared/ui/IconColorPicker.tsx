import { Button, Tooltip } from '@setsuna-desktop/renderer-ui';
import type { CSSProperties } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { ICON_COLORS, iconColorCssValue, normalizeIconColor, type IconColor } from './icon-colors.js';
import './icon-color-picker.css';

export function IconColorPicker({ value, label, colorLabel, disabled = false, onChange }: Readonly<{
  value?: string;
  label: string;
  colorLabel(color: IconColor): string;
  disabled?: boolean;
  onChange(color: IconColor): void;
}>) {
  const { t } = useI18n();
  const selectedColor = normalizeIconColor(value);
  return (
    <span className="icon-color-picker" role="group" aria-label={label}>
      {ICON_COLORS.map((color) => (
        <Tooltip key={color} title={color === 'text' ? t('common.textColor') : color}>
          <Button type="button" variant="ghost" className="icon-color-picker__swatch"
            disabled={disabled} aria-label={color === 'text' ? t('common.textColor') : colorLabel(color)} aria-pressed={selectedColor === color}
            style={{ '--icon-swatch-color': iconColorCssValue(color) } as CSSProperties} onClick={() => onChange(color)} />
        </Tooltip>
      ))}
    </span>
  );
}
