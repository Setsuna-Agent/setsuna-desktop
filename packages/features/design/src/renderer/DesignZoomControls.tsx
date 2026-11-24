import { Minus, Plus } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dropdown, IconButton, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { designShortcutTitle, scrollDesignToolbar } from './DesignTools.js';
import type { DesignShortcuts } from './settings/design-shortcuts.js';

const presets = [50, 100, 200] as const;

export function DesignZoomControls({
  scale, disabled, canZoomIn, canZoomOut, canFit, canFitSelection, onZoom, onFit, onZoomTo, shortcuts, translate: t,
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
  shortcuts: DesignShortcuts;
  translate: RendererTranslate;
}>) {
  const percent = Math.round(scale * 100);
  const label = t('feature.design.zoom');
  const zoomInLabel = t('feature.design.zoomIn');
  const zoomOutLabel = t('feature.design.zoomOut');
  const zoomIn = () => onZoom('in');
  const zoomOut = () => onZoom('out');
  const items: MenuItem[] = [
    { key: 'in', label: zoomInLabel, disabled: !canZoomIn, onClick: zoomIn, extra: <ZoomShortcut label={shortcuts.label('zoomIn')} /> },
    { key: 'out', label: zoomOutLabel, disabled: !canZoomOut, onClick: zoomOut, extra: <ZoomShortcut label={shortcuts.label('zoomOut')} /> },
    { key: 'fit', label: t('feature.design.fit'), disabled: !canFit,
      onClick: () => onFit(false), extra: <ZoomShortcut label={shortcuts.label('fit')} /> },
    { key: 'fitSelection', label: t('feature.design.fitSelection'), disabled: !canFitSelection,
      onClick: () => onFit(true), extra: <ZoomShortcut label={shortcuts.label('fitSelection')} /> },
    { type: 'divider' },
    ...presets.map((level): MenuItem => ({
      key: String(level), label: t('feature.design.zoomTo', { percent: level }), onClick: () => onZoomTo(level / 100),
    })),
  ];
  return <div className="design-canvas__zoom" role="group" aria-label={label} onWheel={scrollDesignToolbar}>
    <IconButton size="small" label={zoomOutLabel} title={designShortcutTitle(zoomOutLabel, shortcuts.label('zoomOut'))}
      disabled={disabled || !canZoomOut} onClick={zoomOut}><Minus size={14} /></IconButton>
    <Dropdown placement="top" disabled={disabled} className="design-zoom-menu" menu={{ items, selectedKeys: [String(percent)] }}>
      <Button size="small" variant="ghost" className="design-canvas__level" aria-label={`${label} ${percent}%`}>
        {percent}%
      </Button>
    </Dropdown>
    <IconButton size="small" label={zoomInLabel} title={designShortcutTitle(zoomInLabel, shortcuts.label('zoomIn'))}
      disabled={disabled || !canZoomIn} onClick={zoomIn}><Plus size={14} /></IconButton>
  </div>;
}

function ZoomShortcut({ label }: Readonly<{ label?: string }>) {
  return label ? <span className="sd-menu__extra design-zoom-menu__shortcut" aria-hidden="true"><kbd>{label}</kbd></span> : null;
}
