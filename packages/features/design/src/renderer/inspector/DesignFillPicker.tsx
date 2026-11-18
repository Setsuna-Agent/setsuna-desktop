import { Blend, Droplet, ImageIcon, ImagePlus, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { ColorPickerControls, ColorPickerSwatch, IconButton, Popover, SelectField, TextField, useToast, type PickerColor } from '@setsuna-desktop/renderer-ui';
import { designBlendModes, designFillImageFits, parseAssetPath, type DesignFill, type DesignFillImage } from '../../contracts/index.js';
import { useProjectImagePreview } from '../DesignImageGallery.js';
import { DesignImagePicker } from '../DesignImagePicker.js';
import { importLocalDesignImage } from '../design-images.js';
import { designCssFill } from '../styles/design-gradients.js';
import { DesignGradientFields } from './DesignGradientFields.js';
import { designPaintPopoverPosition } from './DesignInspectorFields.js';
import './design-fill-picker.css';

export type DesignFillAssets = Pick<ComponentProps<typeof DesignImagePicker>, 'documentRef' | 'assets' | 'loadImage' | 'onImport'>;
const modes = [
  { id: 'solid', icon: Square, label: 'feature.design.fillType.solid' },
  { id: 'gradient', icon: Blend, label: 'feature.design.gradient' },
  { id: 'image', icon: ImageIcon, label: 'feature.design.imageFill' },
] as const;

export function DesignFillPicker({ fill, display, color, label, disabled, assets: imagePicker, onColorPreview, onColorCommit, onPreview, onSave, translate: t }: Readonly<{
  fill: DesignFill; display: DesignFill; color: string; label: string; disabled: boolean; assets: DesignFillAssets;
  onColorPreview(paint: PickerColor | undefined): void;
  onColorCommit(paint: PickerColor): Promise<boolean>;
  onPreview(fill: DesignFill | undefined): void;
  onSave(fill: DesignFill): Promise<boolean>;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [initialFit, setInitialFit] = useState<DesignFillImage['fit']>('cover');
  const [pendingPath, setPendingPath] = useState(false);
  const pathRequest = useRef<AbortController>();
  useEffect(() => () => pathRequest.current?.abort(), []);
  const toast = useToast();
  const kind = fill.image ? 'image' : fill.gradient ? 'gradient' : 'solid';
  const mode = imageMode ? 'image' : kind;
  const fit = fill.image?.fit ?? initialFit;
  const imageSrc = useProjectImagePreview(display.image?.assetPath, imagePicker.loadImage);
  const blocked = disabled || pendingPath;

  function saveImage(assetPath: string) {
    return onSave({ ...fill, styleId: undefined, gradient: undefined, image: { assetPath, fit } });
  }

  async function applyPath(value: string) {
    if (blocked || pathRequest.current || !value || value === fill.image?.assetPath) return;
    const controller = new AbortController();
    pathRequest.current = controller;
    const { signal } = controller;
    setPendingPath(true);
    try {
      const path = /^https:\/\//iu.test(value) ? await importLocalDesignImage(await imagePicker.assets.readLinkedImage(value, signal), {
        ref: imagePicker.documentRef, store: imagePicker.onImport, signal, translate: t,
      }) : parseAssetPath(value);
      signal.throwIfAborted();
      await imagePicker.loadImage(path);
      if (!signal.aborted) await saveImage(path);
    } catch {
      if (!signal.aborted) toast.error(t('feature.design.loadImageFailed', { path: value }));
    } finally {
      pathRequest.current = undefined;
      setPendingPath(false);
    }
  }

  function changeMode(next: typeof mode) {
    setImageMode(next === 'image');
    if (next === kind || next === 'image') return;
    if (next === 'solid') {
      void onSave({ ...fill, gradient: undefined, image: undefined });
    } else {
      void onSave({ ...fill, image: undefined, gradient: { kind: 'linear', angle: 90,
        stops: [{ color: display.color, offset: 0, styleId: fill.styleId }, { color: '#7367f0', offset: 1 }] } });
    }
  }

  const swatch = display.gradient ? designCssFill({ ...display, opacity: 1 })
    : imageSrc ? `center / cover url(${JSON.stringify(imageSrc)})` : display.image ? 'transparent' : display.color;
  return <>
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) { pathRequest.current?.abort(); setImageMode(false); }
    }}
      {...designPaintPopoverPosition} className="sd-color-picker design-fill-picker" contentLabel={label} hideWhenDetached
      content={<div className="design-fill-picker__body" onKeyDown={(event) => event.stopPropagation()}>
        <header className="design-fill-picker__header">
          <div className="design-fill-picker__modes" role="group" aria-label={t('feature.design.fillType')}>
            {modes.map(({ id, icon: Icon, label }) => <IconButton key={id} size="small" label={t(label)} aria-pressed={mode === id}
              disabled={blocked} onClick={() => changeMode(id)}><Icon size={15} /></IconButton>)}
          </div>
          <SelectField className="design-fill-picker__blend" aria-label={t('feature.design.blendMode')}
            title={t(`feature.design.blendMode.${fill.blendMode ?? 'normal'}`)} value={fill.blendMode ?? 'normal'}
            valueContent={<Droplet size={15} aria-hidden="true" />} disabled={blocked} onValueChange={(value) => {
              const blendMode = designBlendModes.find((mode) => mode === value);
              if (blendMode) void onSave({ ...fill, blendMode: blendMode === 'normal' ? undefined : blendMode });
            }}>
            {designBlendModes.map((mode) => <option key={mode} value={mode}>{t(`feature.design.blendMode.${mode}`)}</option>)}
          </SelectField>
        </header>
        {mode === 'solid' ? <ColorPickerControls value={color} opacity={fill.opacity ?? 1} disabled={blocked}
          onPreview={onColorPreview} onCommit={onColorCommit} /> : null}
        {mode === 'gradient' && fill.gradient ? <DesignGradientFields gradient={fill.gradient} disabled={blocked} translate={t}
          onSave={(gradient) => onSave({ ...fill, gradient })}
          onPreview={(gradient) => onPreview(gradient ? { ...fill, gradient } : undefined)} /> : null}
        {mode === 'image' ? <div className="design-fill-picker__image">
          {imageSrc ? <img src={imageSrc} alt="" className="design-fill-picker__image-preview" draggable={false} /> : null}
          <SelectField aria-label={t('feature.design.imageFit')} value={fit} disabled={blocked} onValueChange={(value) => {
            const next = designFillImageFits.find((fit) => fit === value);
            if (!next) return;
            if (fill.image) void onSave({ ...fill, image: { ...fill.image, fit: next } });
            else setInitialFit(next);
          }}>
            {designFillImageFits.map((fit) => <option key={fit} value={fit}>{t(`feature.design.imageFit.${fit}`)}</option>)}
          </SelectField>
          <form className="design-fill-picker__source" onSubmit={(event) => {
            event.preventDefault();
            if (event.target === event.currentTarget) void applyPath(String(new FormData(event.currentTarget).get('imagePath') ?? '').trim());
          }}>
            <TextField key={fill.image?.assetPath ?? 'empty'} name="imagePath" defaultValue={fill.image?.assetPath ?? ''}
              aria-label={t('feature.design.fillImageSource')} placeholder={t('feature.design.fillImageSource')} readOnly={blocked} spellCheck={false} />
            <IconButton size="small" label={t('feature.design.chooseFillImage')} disabled={blocked}
              onClick={() => { setOpen(false); setGallery(true); }}><ImagePlus size={15} /></IconButton>
          </form>
        </div> : null}
      </div>}>
      <IconButton label={label} size="small" disabled={disabled} className="sd-color-picker__trigger">
        <ColorPickerSwatch color={swatch} opacity={display.opacity ?? 1} />
      </IconButton>
    </Popover>
    {gallery ? <DesignImagePicker {...imagePicker} currentPath={fill.image?.assetPath} replacing={Boolean(fill.image)}
      translate={t} onClose={() => { setGallery(false); setImageMode(false); }} onInsert={saveImage} /> : null}
  </>;
}
