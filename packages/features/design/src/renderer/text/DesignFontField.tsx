import { ListFilter } from 'lucide-react';
import { useContext, useRef, useState } from 'react';
import { IconButton, Popover, useToast } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { isDesignFontName } from '../../contracts/design-fonts.js';
import { designInspectorPopoverPosition, InspectorField } from '../inspector/DesignInspectorFields.js';
import { DesignFontPicker } from './DesignFontPicker.js';
import { DesignFontsContext } from './use-design-fonts.js';

type LocalFontsWindow = Window & { queryLocalFonts?: () => Promise<readonly { family: string }[]> };
let localFamilies: readonly string[] | undefined;

export function DesignFontField({ value, disabled, onSave, onPreview, translate: t }: Readonly<{
  value?: string; disabled: boolean; onSave(family: string | undefined): Promise<boolean>; translate: RendererTranslate;
  onPreview?(family: string | undefined, owner: string): void;
}>) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState(localFamilies);
  const saving = useRef(false);
  const library = useContext(DesignFontsContext);
  const toast = useToast();
  const label = t('feature.design.fontFamily');
  const pickerLabel = t('feature.design.localFonts');
  const browse = async () => {
    if (localFamilies) {
      setFamilies(localFamilies);
      return;
    }
    try {
      const fonts = await (window as LocalFontsWindow).queryLocalFonts?.();
      if (fonts) {
        localFamilies = [...new Set(fonts.map(({ family }) => family).filter(isDesignFontName))].sort((a, b) => a.localeCompare(b));
        setFamilies(localFamilies);
      }
    } catch { /* Manual font names and presets remain available if the host denies enumeration. */ }
  };
  async function choose(font: string) {
    if (saving.current || disabled) return;
    saving.current = true;
    try {
      if (library && !await library.choose(font)) { toast.error(t('feature.design.loadFontFailed', { name: font })); return; }
      if (font === value || await onSave(font)) setOpen(false);
    } finally {
      saving.current = false;
    }
  }
  return <InspectorField label={label} value={value ?? ''} placeholder={t('feature.design.font.system')} maxLength={128} readOnly={disabled}
    onDraft={onPreview ? (value, owner) => {
      const family = value?.trim();
      onPreview(family === '' || isDesignFontName(family) ? family : undefined, owner);
    } : undefined}
    onSave={(value) => {
      const family = value.trim();
      return !family || isDesignFontName(family) ? onSave(family || undefined) : Promise.resolve(false);
    }} trailing={<Popover open={open && !disabled} onOpenChange={(next) => {
      if (next && (disabled || saving.current)) return;
      setOpen(next);
      // Local font enumeration needs the trigger's user gesture.
      if (next) void browse();
    }} {...designInspectorPopoverPosition} hideWhenDetached className="design-inspector-picker design-font-picker" contentLabel={pickerLabel}
      content={open && !disabled ? <DesignFontPicker installed={families ?? []} value={value} translate={t}
        onPreview={onPreview}
        onSelect={(font) => { void choose(font); }} /> : null}>
      <IconButton className="design-font-field__picker" label={pickerLabel} size="small" disabled={disabled}>
        <ListFilter size={15} aria-hidden="true" />
      </IconButton>
    </Popover>} />;
}
