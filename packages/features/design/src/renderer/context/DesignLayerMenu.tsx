import { Check, Settings2 } from 'lucide-react';
import { PointMenu, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ComponentActions } from '../components/DesignComponentActions.js';
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

export function DesignLayerMenu({ point, actions, hasSelection, components, onCopyPng, onCopyHtml, onClose, settings, onToggle, translate: t }: SettingsControls & Readonly<{
  point: Point;
  actions: DesignLayerActions;
  hasSelection: boolean;
  components: Pick<ComponentActions, 'library' | 'onInsert'>;
  onCopyPng?: () => void;
  onCopyHtml?: () => void;
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
    children: settingsKeys.map((key): MenuItem => ({
      key, label: t(`feature.design.${key}`),
      extra: settings[key] ? <Check size={14} className="sd-menu__extra" aria-hidden="true" /> : null,
      onClick: ({ domEvent }) => { domEvent.preventDefault(); onToggle(key); },
    })),
  };
  const insertComponent: MenuItem | null = !hasSelection && components.library.length ? {
    key: 'insertComponent', label: t('feature.design.insertComponent'),
    children: components.library.map(({ id, name }) => ({ key: id, label: name, onClick: () => { void components.onInsert(id); } })),
  } : null;
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
  ] : [command('paste'), insertComponent, divider, settingsMenu] }} />;
}
