import { Blend, Droplet, ImageIcon, ImagePlus, Square, Waves } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { ColorPickerControls, ColorPickerSwatch, IconButton, Popover, SegmentedControl, SelectField, TextField, useToast, type PickerColor } from '@setsuna-desktop/renderer-ui';
import { designBlendModes, designFillImageFits, parseAssetPath, type DesignBlendMode, type DesignFillImage, type DesignPaint } from '../../contracts/index.js';
import { splitDesignColor } from '../../contracts/design-color.js';
import { useProjectImagePreview } from '../DesignImageGallery.js';
import { DesignImagePicker, type DesignImageAssets } from '../DesignImagePicker.js';
import type { Bounds } from '../design-geometry.js';
import { importLocalDesignImage } from '../design-images.js';
import { DesignShaderFields } from '../shaders/DesignShaderFields.js';
import { designCssFill } from '../styles/design-gradients.js';
import type { DesignGradientTarget } from '../styles/design-gradient-geometry.js';
import { DesignGradientFields } from './DesignGradientFields.js';
import { designInspectorPopoverPosition } from './DesignInspectorFields.js';
import { designOptionEdits } from './design-inspector-edit.js';
import './design-paint-picker.css';

export type DesignPaintAssets = DesignImageAssets;
export type GradientControls = Readonly<{ target: DesignGradientTarget; bounds: Bounds }>;
const modes = [
  { id: 'solid', icon: Square, label: 'feature.design.fillType.solid' },
  { id: 'gradient', icon: Blend, label: 'feature.design.gradient' },
  { id: 'image', icon: ImageIcon, label: 'feature.design.image' },
  { id: 'shader', icon: Waves, label: 'feature.design.shader' },
] as const;

export function DesignPaintPicker<T extends DesignPaint>({ paint, display, color, opacity, label, disabled, assets: imagePicker, allowShader,
  placement, gradientControls, onColorPreview, onColorCommit, onPreview, onSave, translate: t }: Readonly<{
  paint: T; display: T; color: string; opacity: number; label: string; disabled: boolean; assets?: DesignPaintAssets;
  allowShader?: boolean;
  placement?: ComponentProps<typeof Popover>['placement'];
  gradientControls?: GradientControls;
  onColorPreview(paint: PickerColor | undefined): void;
  onColorCommit(paint: PickerColor): Promise<boolean>;
  onPreview(paint: T | undefined): void;
  onSave(paint: T): Promise<boolean>;
  translate: RendererTranslate;
}>) {
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [sourceMode, setSourceMode] = useState<'image' | 'shader'>();
  const [initialFit, setInitialFit] = useState<DesignFillImage['fit']>('cover');
  const [pendingPath, setPendingPath] = useState(false);
  const pathRequest = useRef<AbortController>();
  useEffect(() => () => pathRequest.current?.abort(), []);
  const toast = useToast();
  const kind = paint.shader ? 'shader' : imagePicker && paint.image ? 'image' : paint.gradient ? 'gradient' : 'solid';
  const mode = sourceMode ?? kind;
  const fit = paint.image?.fit ?? initialFit;
  const imageSrc = useProjectImagePreview(display.image?.assetPath, imagePicker?.loadImage);
  const blocked = disabled || pendingPath;
  const colorBlocked = blocked || (kind === 'solid' && Boolean(paint.styleId));

  function saveImage(assetPath: string) {
    return onSave({ ...paint, styleId: undefined, gradient: undefined, shader: undefined, image: { assetPath, fit } });
  }
  const withBlend = (blendMode: DesignBlendMode) => ({ ...paint, blendMode: blendMode === 'normal' ? undefined : blendMode });
  const withImageFit = (next: DesignFillImage['fit']) => paint.image ? { ...paint, image: { ...paint.image, fit: next } } : undefined;

  async function applyPath(value: string) {
    if (!imagePicker || blocked || pathRequest.current || !value || value === paint.image?.assetPath) return;
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
    if (colorBlocked) return;
    const selectsSource = next === 'image' || next === 'shader';
    setSourceMode(selectsSource ? next : undefined);
    if (next === kind || selectsSource) return;
    if (next === 'solid') {
      void onSave({ ...paint, gradient: undefined, image: undefined, shader: undefined });
    } else {
      void onSave({ ...paint, styleId: undefined, image: undefined, shader: undefined, gradient: { kind: 'linear', angle: 90,
        stops: [{ color, offset: 0, styleId: paint.styleId }, { color, offset: 1, opacity: 0 }] } });
    }
  }

  const solid = splitDesignColor(display.color);
  const swatch = display.gradient ? designCssFill({ ...display, opacity: 1 })
    : imageSrc ? `center / cover url(${JSON.stringify(imageSrc)})` : display.image ? 'transparent' : solid.color;
  const swatchOpacity = (display.opacity ?? 1) * (display.gradient || display.image ? 1 : solid.opacity);
  return <Popover {...(placement ? { placement } : designInspectorPopoverPosition)} hideWhenDetached
      className={gallery ? 'design-tool-popover design-tool-popover--image' : 'sd-color-picker design-paint-picker'}
      contentLabel={gallery ? t(paint.image ? 'feature.design.replaceImage' : 'feature.design.choosePaintImage') : label}
      onInteractOutside={(event) => {
        if (mode === 'gradient' && gradientControls && event.target instanceof Element
          && event.target.closest('[data-design-gradient-handle]')) event.preventDefault();
      }}
      open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) { pathRequest.current?.abort(); setSourceMode(undefined); setGallery(false); }
      }} content={gallery && imagePicker ? <div className="design-tool-popover__content">
        <DesignImagePicker {...imagePicker} currentPath={paint.image?.assetPath} translate={t} onInsert={saveImage}
          onClose={() => { setGallery(false); setSourceMode(undefined); setOpen(false); }} />
      </div> : <div className="design-paint-picker__body" onKeyDown={(event) => event.stopPropagation()}>
        <header className="design-paint-picker__header">
          <SegmentedControl label={label} value={mode} disabled={colorBlocked} iconOnly onChange={changeMode}
            options={modes.filter(({ id }) => (id !== 'image' || imagePicker) && (id !== 'shader' || allowShader && imagePicker)).map(({ id, icon: Icon, label }) => ({
              value: id, label: t(label), icon: <Icon size={15} aria-hidden="true" />,
            }))} />
          <SelectField className="design-paint-picker__blend" aria-label={t('feature.design.blendMode')}
            title={t(`feature.design.blendMode.${paint.blendMode ?? 'normal'}`)} value={paint.blendMode ?? 'normal'}
            valueContent={<Droplet size={15} aria-hidden="true" />} disabled={blocked}
            {...designOptionEdits(designBlendModes, {
              onSave: (mode) => onSave(withBlend(mode)),
              onPreview: (mode) => onPreview(mode === undefined ? undefined : withBlend(mode)),
            })}>
            {designBlendModes.map((mode) => <option key={mode} value={mode}>{t(`feature.design.blendMode.${mode}`)}</option>)}
          </SelectField>
        </header>
        {mode === 'solid' ? <ColorPickerControls value={color.slice(0, 7)} opacity={opacity} disabled={colorBlocked}
          onPreview={onColorPreview} onCommit={onColorCommit} /> : null}
        {mode === 'gradient' && paint.gradient ? <DesignGradientFields gradient={paint.gradient} disabled={blocked} translate={t}
          target={gradientControls?.target} bounds={gradientControls?.bounds}
          onSave={(gradient) => onSave({ ...paint, gradient })}
          onPreview={(gradient) => onPreview(gradient ? { ...paint, gradient } : undefined)} /> : null}
        {mode === 'shader' && allowShader && imagePicker ? <DesignShaderFields paint={paint.shader} imageAssets={imagePicker}
          disabled={blocked} translate={t}
          onSave={(shader) => onSave({ ...paint, styleId: undefined, gradient: undefined, image: undefined, shader })}
          onPreview={(shader) => onPreview(shader ? { ...paint, shader } : undefined)} /> : null}
        {mode === 'image' ? <div className="design-paint-picker__image">
          {imageSrc ? <img src={imageSrc} alt="" className="design-paint-picker__image-preview" draggable={false} /> : null}
          <SelectField aria-label={t('feature.design.imageFit')} value={fit} disabled={blocked}
            {...designOptionEdits(designFillImageFits, {
              onSave: (fit) => {
                const next = withImageFit(fit);
                return next ? onSave(next) : setInitialFit(fit);
              },
              onPreview: paint.image ? (fit) => onPreview(fit === undefined ? undefined : withImageFit(fit)) : undefined,
            })}>
            {designFillImageFits.map((fit) => <option key={fit} value={fit}>{t(`feature.design.imageFit.${fit}`)}</option>)}
          </SelectField>
          <form className="design-paint-picker__source" onSubmit={(event) => {
            event.preventDefault();
            if (event.target === event.currentTarget) void applyPath(String(new FormData(event.currentTarget).get('imagePath') ?? '').trim());
          }}>
            <TextField key={paint.image?.assetPath ?? 'empty'} name="imagePath" defaultValue={paint.image?.assetPath ?? ''}
              aria-label={t('feature.design.paintImageSource')} placeholder={t('feature.design.paintImageSource')} readOnly={blocked} spellCheck={false} />
            <IconButton size="small" label={t('feature.design.choosePaintImage')} disabled={blocked}
              onClick={() => setGallery(true)}><ImagePlus size={15} /></IconButton>
          </form>
        </div> : null}
      </div>}>
      <IconButton label={label} size="small" disabled={disabled} className="sd-color-picker__trigger">
        {display.shader ? <Waves size={14} aria-hidden="true" /> : <ColorPickerSwatch color={swatch} opacity={swatchOpacity} />}
      </IconButton>
    </Popover>;
}
