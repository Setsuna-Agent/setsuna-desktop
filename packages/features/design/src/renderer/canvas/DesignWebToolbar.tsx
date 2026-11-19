import { GripVertical, Minimize2, Monitor, Play, RefreshCw } from 'lucide-react';
import type { CSSProperties, PointerEvent } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton } from '@setsuna-desktop/renderer-ui';
import type { Bounds } from '../design-geometry.js';
import { DesignWebAddressField } from '../inspector/DesignContentSourceFields.js';
import type { DesignWebSession } from './use-design-web-previews.js';
import './design-web-toolbar.css';

export const designWebToolbarHeight = 30;
export const designWebToolbarGap = 6;

export type DesignWebLayerControls = Readonly<{
  mode?: DesignWebSession['mode'];
  canBrowse: boolean;
  devices: readonly Readonly<{ id: string; label: string }>[];
  browse(): void;
  expand(): void;
  save(patch: Readonly<{ url?: string; deviceId?: string }>): Promise<boolean>;
}>;

export function DesignWebToolbar({ actions, anchor, address, deviceId, raised, disabled, onRefresh, onMove, translate: t }: Readonly<{
  actions: DesignWebLayerControls;
  anchor: Pick<Bounds, 'x' | 'y' | 'width'>;
  address?: string;
  deviceId?: string;
  raised: boolean;
  disabled: boolean;
  onRefresh(): void;
  onMove?(event: PointerEvent<HTMLButtonElement>): void;
  translate: RendererTranslate;
}>) {
  const expanded = actions.mode === 'expanded';
  const devices = actions.devices.map(({ id, label }) => ({ key: id, label }));
  const selected = devices.some(({ key }) => key === deviceId) ? deviceId : '';
  const placement = expanded ? undefined : {
    left: anchor.x,
    '--design-web-toolbar-top': `${anchor.y}px`,
    '--design-web-toolbar-width': `${anchor.width}px`,
  } as CSSProperties;
  return <div className="design-web-toolbar" data-expanded={expanded || undefined} data-raised={raised || undefined}
    style={placement} role="toolbar" aria-label={t('feature.design.webToolbar')}>
    {expanded ? <IconButton size="small" label={t('feature.design.collapseWebPreview')} disabled={disabled} onClick={actions.expand}>
      <Minimize2 size={14} />
    </IconButton> : <IconButton size="small" className="design-web-toolbar__grip" label={t('feature.design.moveWebLayer')}
      disabled={disabled || !onMove} onPointerDown={onMove}><GripVertical size={14} /></IconButton>}
    <IconButton size="small" label={t('feature.design.reloadWebPreview')} disabled={disabled || !actions.canBrowse}
      onClick={onRefresh}><RefreshCw size={13} /></IconButton>
    <DesignWebAddressField value={address} placeholder={t('feature.design.webAddress')}
      readOnly={disabled} onSave={(url) => actions.save({ url })} translate={t} />
    <Dropdown placement="bottomRight" disabled={disabled} menu={{
      items: devices,
      selectedKeys: [selected ?? ''],
      onClick: ({ key }) => { void actions.save({ deviceId: key || undefined }); },
    }}>
      <IconButton size="small" label={t('feature.design.webDevice')} disabled={disabled}><Monitor size={14} /></IconButton>
    </Dropdown>
    <IconButton size="small" label={t(actions.mode ? 'feature.design.stopWebPreview' : 'feature.design.openWebPreview')}
      className={actions.mode ? 'design-web-toolbar__exit' : undefined}
      aria-keyshortcuts={actions.mode ? 'Escape' : undefined}
      disabled={disabled || !actions.canBrowse} onClick={actions.browse}>
      {actions.mode ? <kbd>Esc</kbd> : <Play size={13} />}
    </IconButton>
  </div>;
}
