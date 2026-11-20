import { Crop, ImageIcon } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, SelectField } from '@setsuna-desktop/renderer-ui';
import { designImageFits, type DesignImage, type DesignNode } from '../../contracts/index.js';
import { DesignImagePopover, type DesignImageAssets } from '../DesignImagePicker.js';
import { InspectorSection } from './DesignInspectorFields.js';
import { VariableNumberField } from '../styles/DesignVariableField.js';
import type { Point } from '../design-geometry.js';
import { defaultImageCrop } from '../design-image-fit.js';
import { bindDesignNumber, bindDesignValue, designOptionEdits, previewDesignNode, type InspectorFieldEdits } from './design-inspector-edit.js';

export function DesignImageFields({ node, preview, cropping, disabled, revision, imageAssets, onReplace, onToggleCrop, onSave, fieldEdits, translate: t }: Readonly<{
  node: DesignImage; preview?: Point; cropping: boolean; disabled: boolean;
  revision: string; imageAssets: DesignImageAssets;
  onReplace(path: string): Promise<boolean>; onToggleCrop(): void; onSave(node: DesignNode): Promise<boolean>;
  fieldEdits: InspectorFieldEdits; translate: RendererTranslate;
}>) {
  const fit = node.fit ?? 'cover';
  const crop = node.crop ?? defaultImageCrop;
  const fitLabel = t('feature.design.imageFit');
  return <InspectorSection title={t('feature.design.image')}>
    <div className="design-inspector__pair">
      <DesignImagePopover {...imageAssets} currentPath={node.assetPath} revision={revision} disabled={disabled} onInsert={onReplace} translate={t}>
        <Button className="design-inspector__image-action" size="small" variant="ghost" icon={<ImageIcon size={14} />} disabled={disabled}>
          {t('feature.design.replaceImage')}
        </Button>
      </DesignImagePopover>
      <SelectField aria-label={fitLabel} title={fitLabel} value={fit} disabled={disabled}
        {...designOptionEdits(designImageFits, bindDesignValue(fieldEdits, (current, fit) =>
          current.kind === 'image' ? { ...current, fit } : current))}>
        {designImageFits.map((item) => <option key={item} value={item}>{t(`feature.design.imageFit.${item}`)}</option>)}
      </SelectField>
    </div>
    {fit === 'cover' ? <>
      <Button className="design-inspector__image-action" size="small" variant="ghost" icon={<Crop size={14} />}
        aria-pressed={cropping} disabled={disabled} onClick={onToggleCrop}>
        {t(cropping ? 'feature.design.finishCrop' : 'feature.design.adjustCrop')}
      </Button>
      {cropping ? <div className="design-inspector__pair">
        {(['x', 'y'] as const).map((axis) => <VariableNumberField key={axis} target={node} field={`crop.${axis}`}
          disabled={disabled} onBind={onSave} onBindPreview={previewDesignNode(fieldEdits)}
          translate={t} factor={100} label={t(`feature.design.crop.${axis}`)}
          prefix={axis.toUpperCase()} suffix="%" min={0} max={100} value={crop[axis] * 100}
          previewValue={preview ? preview[axis] * 100 : undefined}
          {...bindDesignNumber(fieldEdits, (current, value) => current.kind === 'image' && current.fit !== 'contain'
            ? { ...current, crop: { ...(current.crop ?? defaultImageCrop), [axis]: value / 100 } } : current)} />)}
      </div> : null}
    </> : null}
  </InspectorSection>;
}
