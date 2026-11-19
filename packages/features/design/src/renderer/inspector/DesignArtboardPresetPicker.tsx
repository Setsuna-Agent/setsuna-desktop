import { ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Popover, TextField, useHoverPreview } from '@setsuna-desktop/renderer-ui';
import { designInspectorPopoverPosition } from './DesignInspectorFields.js';

type ArtboardPreset = Readonly<{ name: string; width: number; height: number }>;

const devicePresets: readonly ArtboardPreset[] = [
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { name: 'iPhone 14 Pro', width: 393, height: 852 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone 13 mini', width: 375, height: 812 },
  { name: 'iPhone SE', width: 320, height: 568 },
  { name: 'Android', width: 360, height: 640 },
  { name: 'iPad Mini / Air', width: 744, height: 1133 },
  { name: 'iPad Pro 11″', width: 834, height: 1194 },
  { name: 'iPad Pro 12.9″', width: 1024, height: 1366 },
];

type PickerProps = Readonly<{
  disabled: boolean;
  onPick(preset: ArtboardPreset): void;
  onPreview(preset: ArtboardPreset | undefined, owner: string): void;
  translate: RendererTranslate;
}>;

export function DesignArtboardPresetPicker({ disabled, onPick, onPreview, translate: t }: PickerProps) {
  const [open, setOpen] = useState(false);
  return <Popover open={open && !disabled} onOpenChange={setOpen} {...designInspectorPopoverPosition} hideWhenDetached
    className="design-inspector-picker" contentLabel={t('feature.design.artboardPresets')}
    content={open && !disabled ? <PresetOptions translate={t} onPreview={onPreview} onPick={(preset) => {
      setOpen(false);
      onPick(preset);
    }} /> : null}>
    <Button className="design-artboard-preset-trigger" variant="ghost" size="small" disabled={disabled}>
      {t('feature.design.artboard')} <ChevronDown size={14} aria-hidden="true" />
    </Button>
  </Popover>;
}

function PresetOptions({ onPick, onPreview, translate: t }: Omit<PickerProps, 'disabled'>) {
  const [query, setQuery] = useState('');
  const preview = useHoverPreview(onPreview);
  const search = query.trim().toLowerCase();
  const sizeSearch = search.replace(/(\d)\s*[x×]\s*(?=\d)/gu, '$1 × ');
  const label = t('feature.design.searchArtboardPresets');
  const presets = [
    { name: t('feature.design.preset.phone'), width: 390, height: 844 },
    { name: t('feature.design.preset.tablet'), width: 768, height: 1024 },
    { name: t('feature.design.preset.desktop'), width: 1440, height: 900 },
    ...devicePresets,
  ];
  return <>
    <TextField autoFocus appearance="search" aria-label={label} placeholder={label} leadingIcon={<Search size={14} />}
      value={query} onChange={(event) => { preview.clear(); setQuery(event.currentTarget.value); }} />
    <div className="design-inspector-picker__options design-panel-scroll">
      {presets.map((preset) => {
        const size = `${preset.width} × ${preset.height}`;
        if (!preset.name.toLowerCase().includes(search) && !size.includes(sizeSearch)) return null;
        return <Button key={preset.name} variant="ghost" size="small"
          {...preview.option(() => preset)} onClick={() => { preview.clear(); onPick(preset); }}>
          <span>{preset.name}</span><span>{size}</span>
        </Button>;
      })}
    </div>
  </>;
}
