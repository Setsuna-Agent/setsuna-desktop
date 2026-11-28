import { ChevronRight, CodeXml, FileArchive, Image as ImageIcon, Spline, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, SelectField } from '@setsuna-desktop/renderer-ui';
import type { DesignExportRequest, DesignPngScale } from '../export/use-design-exports.js';

const scales = [1, 2, 3] as const;
const codeFormats = [
  { format: 'html', label: 'HTML' },
  { format: 'html-tailwind', label: 'HTML + Tailwind' },
] as const;

export function DesignShareExports({ disabled, packaging, exportPackage, exportDocument, translate: t }: Readonly<{
  disabled: boolean;
  packaging: boolean;
  exportPackage(): void;
  exportDocument?(request: DesignExportRequest): void;
  translate: RendererTranslate;
}>) {
  const [scale, setScale] = useState<DesignPngScale>(1);
  const renderDisabled = disabled || !exportDocument;
  return <div className="design-share-exports">
    <ExportCard className="design-share-format--package" title={t('feature.design.publication.sourcePackage')} icon={FileArchive}
      disabled={disabled} loading={packaging} onOpen={exportPackage} />
    <div className="design-share-format-grid">
      {codeFormats.map(({ format, label }) => <ExportCard key={format} title={label} icon={CodeXml} disabled={renderDisabled}
        onOpen={() => exportDocument?.({ kind: 'code', action: 'save', format })} />)}
      <div className="design-share-png">
        <ExportCard title="PNG" icon={ImageIcon} disabled={renderDisabled} showArrow={false}
          onOpen={() => exportDocument?.({ kind: 'image', action: 'save', scale })} />
        <SelectField className="design-share-scale" aria-label={t('feature.design.exportScale')} value={String(scale)} disabled={renderDisabled}
          menuMinWidth={84} onValueChange={(value) => { setScale(scales.find((item) => item === Number(value)) ?? 1); }}>
          {scales.map((item) => <option key={item} value={item}>{item}×</option>)}
        </SelectField>
      </div>
      <ExportCard title="SVG" icon={Spline} disabled={renderDisabled} onOpen={() => exportDocument?.({ kind: 'svg', action: 'save' })} />
    </div>
  </div>;
}

function ExportCard({ className, title, icon: Icon, disabled, loading, showArrow = true, onOpen }: Readonly<{
  className?: string;
  title: string;
  icon: LucideIcon;
  disabled: boolean;
  loading?: boolean;
  showArrow?: boolean;
  onOpen(): void;
}>) {
  return <Button variant="secondary" className={className ? `design-share-format ${className}` : 'design-share-format'}
    icon={<Icon className="design-share-format__icon" size={18} aria-hidden="true" />} loading={loading} disabled={disabled} onClick={onOpen}>
    <span className="design-share-format__name">{title}</span>
    {showArrow ? <ChevronRight className="design-share-format__arrow" size={15} aria-hidden="true" /> : null}
  </Button>;
}
