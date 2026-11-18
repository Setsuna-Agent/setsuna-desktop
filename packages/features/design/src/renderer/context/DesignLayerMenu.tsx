import { Check, Settings2 } from 'lucide-react';
import { Checkbox, Dialog, PointMenu, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { Point } from '../design-geometry.js';
import type { DesignCanvasSetting, DesignCanvasSettings } from './design-canvas-settings.js';
import type { DesignLayerActions, DesignLayerCommand } from './design-layer-commands.js';
import { designLayerShortcutLabel } from './design-layer-shortcuts.js';

const settingsKeys = ['showPixelGrid', 'snapToPixelGrid', 'snapToObjects'] as const;

const commands = {
  copy: 'copyLayers', paste: 'pasteHere', replace: 'pasteReplace', front: 'bringToFront', back: 'sendToBack',
  group: 'groupSelection', frame: 'wrapInFrame', ungroup: 'ungroup', addLayout: 'addAutoLayout', removeLayout: 'removeAutoLayout',
  component: 'createComponent', detach: 'detachComponent', flipX: 'flipHorizontal', flipY: 'flipVertical', delete: 'delete',
  mask: 'createMask', removeMask: 'removeMask', union: 'unionPaths', subtract: 'subtractPaths',
} satisfies Record<DesignLayerCommand, string>;
const divider: MenuItem = { type: 'divider' };

type SettingsControls = Readonly<{
  settings: DesignCanvasSettings;
  onToggle(setting: DesignCanvasSetting): void;
  translate: RendererTranslate;
}>;

export function DesignLayerMenu({ point, actions, hasSelection, onCopyPng, onCopyHtml, onOpenSettings, onClose, settings, onToggle, translate: t }: SettingsControls & Readonly<{
  point: Point;
  actions: DesignLayerActions;
  hasSelection: boolean;
  onCopyPng?: () => void;
  onCopyHtml?: () => void;
  onOpenSettings(): void;
  onClose(): void;
}>) {
  const mac = /Mac/u.test(navigator.platform);
  const command = (key: DesignLayerCommand): MenuItem => {
    const shortcut = designLayerShortcutLabel(key, mac);
    return { key, label: t(`feature.design.${commands[key]}`), disabled: !actions[key], danger: key === 'delete',
      extra: shortcut ? <span className="sd-menu__extra">{shortcut}</span> : undefined, onClick: actions[key] };
  };
  const settingsMenu: MenuItem = {
    key: 'settings', label: t('feature.design.canvasSettings'), icon: <Settings2 size={14} />,
    children: [...settingsKeys.map((key): MenuItem => ({
      key, label: t(`feature.design.${key}`),
      icon: settings[key] ? <Check size={14} /> : <span aria-hidden="true" />,
      onClick: ({ domEvent }) => { domEvent.preventDefault(); onToggle(key); },
    })), divider, { key: 'openSettings', label: t('feature.design.openCanvasSettings'), onClick: onOpenSettings }],
  };
  return <PointMenu {...point} onClose={onClose} menu={{ items: hasSelection ? [
    command('copy'),
    { key: 'copyAs', label: t('feature.design.copyAs'), disabled: !onCopyPng && !onCopyHtml, children: [
      { key: 'png', label: 'PNG', disabled: !onCopyPng, onClick: onCopyPng },
      { key: 'html', label: 'HTML', disabled: !onCopyHtml, onClick: onCopyHtml },
    ] },
    command('paste'), command('replace'), divider,
    command('front'), command('back'), divider,
    command('group'), command('frame'), command('ungroup'), command('addLayout'), command('removeLayout'), divider,
    command('component'), actions.detach ? command('detach') : null, divider,
    ...(['mask', 'removeMask', 'union', 'subtract'] as const).flatMap((key) => actions[key] ? [command(key)] : []),
    command('flipX'), command('flipY'), divider, command('delete'), divider, settingsMenu,
  ] : [command('paste'), divider, settingsMenu] }} />;
}

export function DesignCanvasSettingsDialog({ settings, onToggle, onClose, translate: t }: SettingsControls & Readonly<{ onClose(): void }>) {
  return <Dialog title={t('feature.design.canvasSettings')} width={340} closeLabel={t('feature.design.close')} onClose={onClose}>
    <div className="design-canvas-settings">
      {settingsKeys.map((key) => <Checkbox key={key} checked={settings[key]} onChange={() => onToggle(key)}>
        {t(`feature.design.${key}`)}
      </Checkbox>)}
    </div>
  </Dialog>;
}
