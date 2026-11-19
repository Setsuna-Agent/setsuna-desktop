import { Minus, Plus } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dropdown, IconButton, type MenuItem } from '@setsuna-desktop/renderer-ui';

const presets = [50, 100, 200] as const;

export function DesignZoomControls({
  scale, disabled, canZoomIn, canZoomOut, canFit, canFitSelection, onZoom, onFit, onZoomTo, translate: t,
}: Readonly<{
  scale: number;
  disabled: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  canFit: boolean;
  canFitSelection: boolean;
  onZoom(direction: 'in' | 'out'): void;
  onFit(selection: boolean): void;
  onZoomTo(scale: number): void;
  translate: RendererTranslate;
}>) {
  const percent = Math.round(scale * 100);
  const label = t('feature.design.zoom');
  const zoomInLabel = t('feature.design.zoomIn');
  const zoomOutLabel = t('feature.design.zoomOut');
  const zoomIn = () => onZoom('in');
  const zoomOut = () => onZoom('out');
  const shift = /Mac/u.test(navigator.platform) ? '⇧' : 'Shift';
  const items: MenuItem[] = [
    { key: 'in', label: zoomInLabel, disabled: !canZoomIn, onClick: zoomIn, extra: <ZoomShortcut keys={['+']} /> },
    { key: 'out', label: zoomOutLabel, disabled: !canZoomOut, onClick: zoomOut, extra: <ZoomShortcut keys={['−']} /> },
    { key: 'fit', label: t('feature.design.fit'), disabled: !canFit,
      onClick: () => onFit(false), extra: <ZoomShortcut keys={[shift, '1']} /> },
    { key: 'fitSelection', label: t('feature.design.fitSelection'), disabled: !canFitSelection,
      onClick: () => onFit(true), extra: <ZoomShortcut keys={[shift, '2']} /> },
    { type: 'divider' },
    ...presets.map((level): MenuItem => ({
      key: String(level), label: t('feature.design.zoomTo', { percent: level }), onClick: () => onZoomTo(level / 100),
    })),
  ];
  return <div className="design-canvas__zoom" role="group" aria-label={label}>
    <IconButton size="small" label={zoomOutLabel} disabled={disabled || !canZoomOut} onClick={zoomOut}><Minus size={13} /></IconButton>
    <Dropdown placement="top" disabled={disabled} className="design-zoom-menu" menu={{ items, selectedKeys: [String(percent)] }}>
      <Button size="small" variant="ghost" className="design-canvas__level" aria-label={`${label} ${percent}%`}>
        {percent}%
      </Button>
    </Dropdown>
    <IconButton size="small" label={zoomInLabel} disabled={disabled || !canZoomIn} onClick={zoomIn}><Plus size={13} /></IconButton>
  </div>;
}

function ZoomShortcut({ keys }: Readonly<{ keys: readonly string[] }>) {
  return <span className="sd-menu__extra design-zoom-menu__shortcut" aria-hidden="true">
    {keys.map((key) => <kbd key={key}>{key}</kbd>)}
  </span>;
}
