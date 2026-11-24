import type { RendererFeatureMessageKey } from '@setsuna-desktop/feature-core/renderer';
import { formatKeyboardShortcutBinding, keyboardShortcutFromEvent, normalizeKeyboardShortcutBinding,
  type KeyboardShortcutEvent, type KeyboardShortcutPlatform } from '@setsuna-desktop/renderer-ui';
import type { DesignLayerCommand } from '../context/design-layer-commands.js';
import type { DesignTool } from '../use-design-canvas-gestures.js';

export const designLayerLabels = {
  copy: 'copyLayers', paste: 'pasteHere', replace: 'pasteReplace', front: 'bringToFront', back: 'sendToBack',
  group: 'groupSelection', frame: 'wrapInFrame', ungroup: 'ungroup', addLayout: 'addAutoLayout', removeLayout: 'removeAutoLayout',
  component: 'createComponent', detach: 'detachComponent', flipX: 'flipHorizontal', flipY: 'flipVertical', delete: 'delete',
  mask: 'createMask', removeMask: 'removeMask', union: 'unionPaths', subtract: 'subtractPaths',
} as const satisfies Record<DesignLayerCommand, string>;

function tool<T extends DesignTool>(tool: T, ...bindings: string[]) {
  return { id: `tool.${tool}` as const, kind: 'tool', tool, labelKey: `feature.design.tool.${tool}` as const, bindings } as const;
}

function layer<T extends DesignLayerCommand>(layer: T, ...bindings: string[]) {
  return { id: `layer.${layer}` as const, kind: 'layer', layer, labelKey: `feature.design.${designLayerLabels[layer]}` as const, bindings } as const;
}

function editor<T extends string>(id: T, labelKey: RendererFeatureMessageKey, ...bindings: string[]) {
  return { id, kind: 'editor', labelKey, bindings } as const;
}

export const designShortcutCommands = [
  tool('select', 'KeyV'), tool('hand', 'KeyH'), tool('frame', 'KeyF'), tool('rectangle', 'KeyR'),
  tool('line', 'KeyL'), tool('arrow', 'Shift+KeyL'), tool('ellipse', 'KeyO'), tool('polygon', 'KeyG'),
  tool('pen', 'KeyP'), tool('brush', 'KeyB'), tool('pencil', 'KeyN'), tool('text', 'KeyT'),
  editor('image', 'feature.design.addImage', 'Mod+Shift+KeyK'),
  editor('undo', 'feature.design.undo', 'Mod+KeyZ'), editor('redo', 'feature.design.redo', 'Mod+Shift+KeyZ', 'Mod+KeyY'),
  editor('duplicate', 'feature.design.duplicate', 'Mod+KeyD'), editor('selectAll', 'feature.design.selectAll', 'Mod+KeyA'),
  layer('replace', 'Mod+Alt+KeyR'), layer('front', 'BracketRight'), layer('back', 'BracketLeft'),
  layer('group', 'Mod+KeyG'), layer('frame', 'Mod+Alt+KeyG'), layer('ungroup', 'Mod+Shift+KeyG'),
  layer('addLayout', 'Shift+KeyA'), layer('removeLayout', 'Alt+Shift+KeyA'), layer('component', 'Mod+Alt+KeyK'),
  layer('flipX', 'Shift+KeyH'), layer('flipY', 'Shift+KeyV'), layer('delete', 'Delete', 'Backspace'),
  editor('zoomIn', 'feature.design.zoomIn', 'Shift+Equal', 'Equal', 'NumpadAdd'),
  editor('zoomOut', 'feature.design.zoomOut', 'Minus', 'NumpadSubtract'),
  editor('fit', 'feature.design.fit', 'Shift+Digit1'), editor('fitSelection', 'feature.design.fitSelection', 'Shift+Digit2'),
] as const;

type DesignShortcutCommand = (typeof designShortcutCommands)[number];
export type DesignShortcutId = DesignShortcutCommand['id'];
export type DesignShortcutOverrides = Partial<Record<DesignShortcutId, readonly string[]>>;
const empty: DesignShortcutOverrides = {};
const byId = new Map(designShortcutCommands.map((command) => [command.id, command]));
const defaultChords = new Set(designShortcutCommands.flatMap(({ bindings }) => bindings));

export function designShortcutPlatform(): KeyboardShortcutPlatform {
  return typeof navigator !== 'undefined' && /Mac/u.test(navigator.platform) ? 'darwin' : 'win32';
}

function primaryBinding(binding: string, platform: KeyboardShortcutPlatform) {
  return normalizeKeyboardShortcutBinding(binding.replace('Mod+', platform === 'darwin' ? 'Meta+' : 'Control+'), true)!;
}

function defaultBindings(id: DesignShortcutId, platform: KeyboardShortcutPlatform) {
  return byId.get(id)!.bindings.map((binding) => primaryBinding(binding, platform));
}

export function readDesignShortcutOverrides(value: unknown): DesignShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  return Object.fromEntries(designShortcutCommands.flatMap(({ id }) => {
    const entry = (value as Record<string, unknown>)[id];
    return Array.isArray(entry) ? [[id, normalizeDesignBindings(entry)]] : [];
  }));
}

export function normalizeDesignBindings(bindings: readonly unknown[]) {
  return [...new Set(bindings.flatMap((binding) => normalizeKeyboardShortcutBinding(binding, true) ?? []))];
}

export function restoreDesignShortcut(overrides: DesignShortcutOverrides, id: DesignShortcutId, platform: KeyboardShortcutPlatform) {
  const restored = new Set(defaultBindings(id, platform));
  const next = { ...overrides };
  for (const command of designShortcutCommands) {
    const bindings = next[command.id];
    if (bindings?.some((binding) => restored.has(binding))) next[command.id] = bindings.filter((binding) => !restored.has(binding));
  }
  delete next[id];
  return next;
}

export function createDesignShortcuts(overrides: DesignShortcutOverrides, platform: KeyboardShortcutPlatform) {
  const claimed = new Set(Object.values(overrides).flat());
  const effective = new Map<DesignShortcutId, readonly string[]>();
  const byBinding = new Map<string, { command: DesignShortcutCommand; custom: boolean }>();
  for (const command of designShortcutCommands) {
    const defaults = defaultBindings(command.id, platform);
    const bindings = overrides[command.id] ?? defaults.filter((binding) => !claimed.has(binding));
    effective.set(command.id, bindings);
    for (const binding of bindings) byBinding.set(binding, { command, custom: !defaults.includes(binding) });
  }
  const primary = platform === 'darwin' ? 'Meta+' : 'Control+';
  const alternatePrimary = platform === 'darwin' ? 'Control+' : 'Meta+';
  for (const [binding, entry] of [...byBinding]) {
    // Keep both primary modifiers for each default binding that is still present.
    if (entry.custom) continue;
    const alternate = binding.replace(primary, alternatePrimary);
    const normalized = normalizeKeyboardShortcutBinding(alternate, true);
    if (normalized && !byBinding.has(normalized)) byBinding.set(normalized, entry);
  }

  const bindingsFor = (id: string) => effective.get(id as DesignShortcutId) ?? [];
  return {
    bindingsFor,
    platform,
    label(id: string) {
      const binding = bindingsFor(id)[0];
      return binding ? formatKeyboardShortcutBinding(binding, platform) : undefined;
    },
    ariaBindings(id: string) {
      return bindingsFor(id).map((binding) => binding.replace(/(?:Key|Digit)([A-Z0-9])$/u, '$1')).join(' ') || undefined;
    },
    match(event: KeyboardShortcutEvent) {
      const recorded = keyboardShortcutFromEvent(event);
      if (recorded === null) return;
      const custom = byBinding.get(recorded);
      if (custom?.custom) return custom.command;

      // Punctuation used to zoom can live on the physical bracket keys in some layouts.
      const zoom = defaultZoomBinding(event);
      if (zoom) {
        const entry = byBinding.get(zoom);
        return entry?.custom === false ? entry.command : undefined;
      }
      const letter = /^[A-Za-z]$/u.test(event.key) ? `Key${event.key.toUpperCase()}` : undefined;
      const code = letter ?? (event.code || event.key);
      const binding = keyboardShortcutFromEvent(event, code);
      if (!binding) return;
      const exact = byBinding.get(binding);
      if (exact && !exact.custom && exact.command.id !== 'zoomIn' && exact.command.id !== 'zoomOut') return exact.command;
      const shiftedTool = binding.startsWith('Shift+Key') && !defaultChords.has(binding) ? byBinding.get(binding.slice('Shift+'.length)) : undefined;
      if (shiftedTool?.command.kind === 'tool' && !shiftedTool.custom) return shiftedTool.command;
    },
  };
}

function defaultZoomBinding({ key, code, ctrlKey, metaKey, shiftKey }: KeyboardShortcutEvent) {
  if (ctrlKey || metaKey) return;
  if (key === '-') return code === 'NumpadSubtract' ? code : 'Minus';
  if (key !== '+' && key !== '=') return;
  if (code === 'NumpadAdd') return code;
  return shiftKey ? 'Shift+Equal' : 'Equal';
}

export type DesignShortcuts = ReturnType<typeof createDesignShortcuts>;
