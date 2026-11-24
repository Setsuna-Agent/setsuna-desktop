import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { IconButton, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { InspectorSection } from '../inspector/DesignInspectorFields.js';
import type { DesignCodeFormat } from './export-design-html.js';
import type { DesignExportRequest, DesignPngScale } from './use-design-exports.js';

const scales = [1, 2, 3] as const;

export function DesignExportFields({ disabled, onExport, translate: t }: Readonly<{
  disabled: boolean;
  onExport(request: DesignExportRequest): void;
  translate: RendererTranslate;
}>) {
  const [format, setFormat] = useState<DesignCodeFormat>('html-tailwind');
  const [scale, setScale] = useState<DesignPngScale>(1);
  const [imageFormat, setImageFormat] = useState<'png' | 'svg'>('png');
  return <InspectorSection title={t('feature.design.layerExport')}>
    <div className="design-inspector__export-row">
      <SelectField className="design-inspector__export-code-format" aria-label={t('feature.design.codeFormat')} value={format} disabled={disabled}
        onValueChange={(value) => { setFormat(value === 'html' ? 'html' : 'html-tailwind'); }}>
        <option value="html-tailwind">HTML + Tailwind</option>
        <option value="html">HTML</option>
      </SelectField>
      <div className="design-inspector__export-actions">
        <IconButton size="small" label={t('feature.design.copyHtml')} disabled={disabled}
          onClick={() => onExport({ kind: 'code', action: 'copy', format })}><Copy size={14} /></IconButton>
        <IconButton size="small" label={t('feature.design.saveHtml')} disabled={disabled}
          onClick={() => onExport({ kind: 'code', action: 'save', format })}><Download size={14} /></IconButton>
      </div>
    </div>
    <div className="design-inspector__export-row">
      <SelectField aria-label={t('feature.design.exportImageFormat')} value={imageFormat} disabled={disabled}
        onValueChange={(value) => setImageFormat(value === 'svg' ? 'svg' : 'png')}>
        <option value="png">PNG</option>
        <option value="svg">SVG</option>
      </SelectField>
      {imageFormat === 'png' ? <SelectField className="design-inspector__export-scale" aria-label={t('feature.design.exportScale')} value={String(scale)}
        disabled={disabled} onValueChange={(value) => { setScale(scales.find((item) => item === Number(value)) ?? 1); }}>
        {scales.map((item) => <option key={item} value={item}>{item}×</option>)}
      </SelectField> : null}
      <div className="design-inspector__export-actions">
        <IconButton size="small" label={t('feature.design.exportLayer')} disabled={disabled}
          onClick={() => onExport(imageFormat === 'svg' ? { kind: 'svg', action: 'save' }
            : { kind: 'image', action: 'save', scale })}><Download size={14} /></IconButton>
      </div>
    </div>
  </InspectorSection>;
}
