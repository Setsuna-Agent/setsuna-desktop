import { Minus, Plus } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dropdown, IconButton } from '@setsuna-desktop/renderer-ui';

export type DesignPrototypeZoom = 'window' | 'width' | number;
const presets = ['window', 'width', 1] as const;
const zoomStep = 1.25;
const minScale = 0.05;
const maxScale = 8;

export function DesignPrototypeZoomControls({ zoom, scale, onChange, translate: t }: Readonly<{
  zoom: DesignPrototypeZoom;
  scale: number;
  onChange(zoom: DesignPrototypeZoom): void;
  translate: RendererTranslate;
}>) {
  const label = t('feature.design.prototype.scale');
  const inLabel = t('feature.design.zoomIn');
  const outLabel = t('feature.design.zoomOut');
  const percent = `${Math.max(1, Math.round(scale * 100))}%`;
  const zoomIn = () => onChange(Math.min(maxScale, scale * zoomStep));
  const zoomOut = () => onChange(Math.max(minScale, scale / zoomStep));
  const canZoomIn = scale < maxScale;
  const canZoomOut = scale > minScale;

  return <div className="design-prototype-corner design-prototype-zoom" role="group" aria-label={label}>
    <IconButton size="small" label={outLabel} disabled={!canZoomOut} onClick={zoomOut}><Minus size={13} /></IconButton>
    <Dropdown modal placement="topRight" menu={{
      selectedKeys: [String(zoom)],
      items: [
        { key: 'in', label: inLabel, disabled: !canZoomIn, onClick: zoomIn },
        { key: 'out', label: outLabel, disabled: !canZoomOut, onClick: zoomOut },
        ...presets.map((mode) => ({
          key: String(mode), label: mode === 1 ? '100%' : t(`feature.design.prototype.scale.${mode}`),
          onClick: () => onChange(mode),
        })),
      ],
    }}>
      <Button className="design-prototype-zoom-level" size="small" variant="ghost" aria-label={`${label} ${percent}`}>{percent}</Button>
    </Dropdown>
    <IconButton size="small" label={inLabel} disabled={!canZoomIn} onClick={zoomIn}><Plus size={13} /></IconButton>
  </div>;
}
