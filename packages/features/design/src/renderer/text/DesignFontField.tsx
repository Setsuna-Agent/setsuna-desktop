import { ListFilter } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designFontFamilies } from '../../contracts/index.js';
import { InspectorField } from '../inspector/DesignInspectorFields.js';

type LocalFontsWindow = Window & { queryLocalFonts?: () => Promise<readonly { family: string }[]> };
let localFamilies: readonly string[] | undefined;

function validFamily(font: string) {
  return font.length <= 128 && !/[\p{C}]/u.test(font);
}

export function DesignFontField({ value, disabled, onSave, translate: t }: Readonly<{
  value?: string; disabled: boolean; onSave(family: string | undefined): Promise<boolean>; translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState(localFamilies);
  const [query, setQuery] = useState('');
  const label = t('feature.design.fontFamily');
  const browse = async () => {
    setOpen(true);
    setQuery('');
    if (localFamilies) {
      setFamilies(localFamilies);
      return;
    }
    try {
      const fonts = await (window as LocalFontsWindow).queryLocalFonts?.();
      if (fonts) {
        localFamilies = [...new Set(fonts.map(({ family }) => family).filter((font) => font && validFamily(font)))].sort((a, b) => a.localeCompare(b));
        setFamilies(localFamilies);
      }
    } catch { /* Manual font names and presets remain available if the host denies enumeration. */ }
  };
  const term = query.trim().toLowerCase();
  const options = [...designFontFamilies.map((font) => ({ font, name: t(`feature.design.font.${font}`) })),
    ...(families ?? []).filter((font) => !designFontFamilies.some((preset) => preset === font)).map((font) => ({ font, name: font }))]
    .filter(({ name }) => !term || name.toLowerCase().includes(term));
  return <div className="design-inspector__paired-control">
    <InspectorField label={label} value={value ?? ''} placeholder={t('feature.design.font.system')} maxLength={128} readOnly={disabled}
      onSave={(value) => validFamily(value.trim()) ? onSave(value.trim() || undefined) : Promise.resolve(false)} />
    <IconButton label={t('feature.design.localFonts')} size="small" disabled={disabled} onClick={() => { void browse(); }}>
      <ListFilter size={15} />
    </IconButton>
    {open ? <Dialog title={t('feature.design.localFonts')} width={360} onClose={() => setOpen(false)}>
      <TextField appearance="search" autoFocus value={query} aria-label={t('feature.design.fontSearch')}
        placeholder={t('feature.design.fontSearch')} onChange={(event) => setQuery(event.target.value)} />
      <div className="design-font-options">
        {options.map(({ font, name }) => <Button key={font} size="small" variant="ghost" aria-pressed={(value ?? 'system') === font}
          onClick={() => { void onSave(font).then((ok) => { if (ok || font === value) setOpen(false); }); }}>
          {name}
        </Button>)}
      </div>
    </Dialog> : null}
  </div>;
}
