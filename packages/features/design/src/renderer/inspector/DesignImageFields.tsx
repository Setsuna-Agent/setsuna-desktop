import { Crop, ImageIcon } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, SelectField } from '@setsuna-desktop/renderer-ui';
import { designImageFits, type DesignImage, type DesignNode } from '../../contracts/index.js';
import { InspectorSection, NumberField } from './DesignInspectorFields.js';
import type { Point } from '../design-geometry.js';
import { defaultImageCrop } from '../design-image-fit.js';
import { bindDesignNumber, type InspectorNumberEdits } from './design-inspector-edit.js';

export function DesignImageFields({ node, preview, cropping, disabled, onReplace, onToggleCrop, onSave, numberEdits, translate: t }: Readonly<{
  node: DesignImage; preview?: Point; cropping: boolean; disabled: boolean;
  onReplace(): void; onToggleCrop(): void; onSave(node: DesignNode): Promise<boolean>;
  numberEdits: InspectorNumberEdits; translate: RendererTranslate;
}>) {
  const fit = node.fit ?? 'cover';
  const crop = node.crop ?? defaultImageCrop;
  const fitLabel = t('feature.design.imageFit');
  return <InspectorSection title={t('feature.design.image')}>
    <div className="design-inspector__pair">
      <Button className="design-inspector__image-action" size="small" variant="ghost" icon={<ImageIcon size={14} />}
        disabled={disabled} onClick={onReplace}>
        {t('feature.design.replaceImage')}
      </Button>
      <SelectField aria-label={fitLabel} title={fitLabel} value={fit} disabled={disabled}
        onValueChange={(value) => {
          const next = designImageFits.find((item) => item === value);
          if (next && next !== fit) void onSave({ ...node, fit: next });
        }}>
        {designImageFits.map((item) => <option key={item} value={item}>{t(`feature.design.imageFit.${item}`)}</option>)}
      </SelectField>
    </div>
    {fit === 'cover' ? <>
      <Button className="design-inspector__image-action" size="small" variant="ghost" icon={<Crop size={14} />}
        aria-pressed={cropping} disabled={disabled} onClick={onToggleCrop}>
        {t(cropping ? 'feature.design.finishCrop' : 'feature.design.adjustCrop')}
      </Button>
      {cropping ? <div className="design-inspector__pair">
        {(['x', 'y'] as const).map((axis) => <NumberField key={axis} label={t(`feature.design.crop.${axis}`)}
          prefix={axis.toUpperCase()} suffix="%" min={0} max={100} value={crop[axis] * 100}
          previewValue={preview ? preview[axis] * 100 : undefined}
          {...bindDesignNumber(numberEdits, (current, value) => current.kind === 'image' && current.fit !== 'contain'
            ? { ...current, crop: { ...(current.crop ?? defaultImageCrop), [axis]: value / 100 } } : current)} />)}
      </div> : null}
    </> : null}
  </InspectorSection>;
}
