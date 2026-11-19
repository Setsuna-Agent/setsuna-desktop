import { LibraryBig, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, Popover, TextField } from '@setsuna-desktop/renderer-ui';
import { DesignPreviewTile } from '../DesignImageGallery.js';
import { designInspectorPopoverPosition } from '../inspector/DesignInspectorFields.js';
import { designShaderPresets, type DesignShaderPreset, type DesignShaderSource } from './design-shader-presets.js';
import { drawDesignShader } from './design-shader-renderer.js';
import '../design-image-picker.css';

type LibraryProps = Readonly<{
  disabled: boolean; current?: string; onApply(preset: DesignShaderSource): void; translate: RendererTranslate;
}>;

export function DesignShaderLibrary({ disabled, current, onApply, translate: t }: LibraryProps) {
  const [open, setOpen] = useState(false);
  const label = t('feature.design.shaderLibrary');
  return <Popover open={open && !disabled} onOpenChange={setOpen} {...designInspectorPopoverPosition} hideWhenDetached
    className="design-inspector-picker design-image-picker-popover design-shader-library" contentLabel={label}
    content={open && !disabled ? <ShaderGallery label={label} current={current} translate={t} onApply={(preset) => {
      setOpen(false);
      if (current !== preset.source) onApply(preset);
    }} /> : null}>
    <IconButton size="small" label={label} disabled={disabled}><LibraryBig size={14} aria-hidden="true" /></IconButton>
  </Popover>;
}

function ShaderGallery({ label, current, onApply, translate: t }: Omit<LibraryProps, 'disabled'> & { label: string }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase();
  const search = t('feature.design.searchShaders');
  return <>
    <TextField autoFocus appearance="search" leadingIcon={<Search size={14} />} aria-label={search} placeholder={search}
      value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    <div className="design-image-picker__gallery" role="group" aria-label={label}>
      {designShaderPresets.map((preset) => {
        const name = t(preset.label);
        if (!name.toLocaleLowerCase().includes(term) && !preset.name.includes(term)) return null;
        return <DesignPreviewTile key={preset.name} title={name} label={name} selected={preset.source === current} onSelect={() => onApply(preset)}>
          <ShaderThumbnail preset={preset} />
        </DesignPreviewTile>;
      })}
    </div>
  </>;
}

const thumbnailSize = { width: 160, height: 120 };

function ShaderThumbnail({ preset }: { preset: DesignShaderPreset }) {
  const target = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = target.current?.getContext('2d');
    if (!context) return;
    try {
      const frame = drawDesignShader(preset.source, { assetPath: preset.name }, { ...thumbnailSize, time: 2, texture: () => undefined });
      context.drawImage(frame, 0, 0);
    } catch {
      // Keep the picker usable if the graphics context is temporarily unavailable.
    }
  }, [preset]);
  return <canvas ref={target} {...thumbnailSize} aria-hidden="true" />;
}
