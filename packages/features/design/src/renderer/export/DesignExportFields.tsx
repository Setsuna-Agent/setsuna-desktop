import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button, SelectField } from '@setsuna-desktop/renderer-ui';
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
    <div className="design-inspector__export-group">
      <SelectField aria-label={t('feature.design.codeFormat')} value={format} disabled={disabled}
        onValueChange={(value) => { setFormat(value === 'html' ? 'html' : 'html-tailwind'); }}>
        <option value="html-tailwind">HTML + Tailwind</option>
        <option value="html">HTML</option>
      </SelectField>
      <div className="design-inspector__pair design-inspector__export-actions">
        <Button size="small" variant="ghost" icon={<Copy size={13} />} disabled={disabled}
          onClick={() => onExport({ kind: 'code', action: 'copy', format })}>{t('feature.design.copyHtml')}</Button>
        <Button size="small" variant="ghost" icon={<Download size={13} />} disabled={disabled}
          onClick={() => onExport({ kind: 'code', action: 'save', format })}>{t('feature.design.saveHtml')}</Button>
      </div>
    </div>
    <div className="design-inspector__export-group">
      <div className="design-inspector__pair">
        {imageFormat === 'png' ? <SelectField aria-label={t('feature.design.exportScale')} value={String(scale)} disabled={disabled}
          onValueChange={(value) => { setScale(scales.find((item) => item === Number(value)) ?? 1); }}>
          {scales.map((item) => <option key={item} value={item}>{item}×</option>)}
        </SelectField> : <span />}
        <SelectField aria-label={t('feature.design.exportImageFormat')} value={imageFormat} disabled={disabled}
          onValueChange={(value) => setImageFormat(value === 'svg' ? 'svg' : 'png')}>
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
        </SelectField>
      </div>
      <Button className="design-inspector__export-actions" size="small" variant="ghost" icon={<Download size={14} />} disabled={disabled}
        onClick={() => onExport(imageFormat === 'svg' ? { kind: 'svg', action: 'save' }
          : { kind: 'image', action: 'save', scale })}>{t('feature.design.exportLayer')}</Button>
    </div>
  </InspectorSection>;
}
