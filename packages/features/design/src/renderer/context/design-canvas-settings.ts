import { useMemo, useSyncExternalStore } from 'react';
import type { KeyboardShortcutConflict } from '@setsuna-desktop/renderer-ui';
import {
  createDesignShortcuts, designShortcutPlatform, normalizeDesignBindings, readDesignShortcutOverrides, restoreDesignShortcut,
  type DesignShortcutId, type DesignShortcutOverrides,
} from '../settings/design-shortcuts.js';

export const defaultDesignCanvasSettings = { showPixelGrid: false, snapToPixelGrid: false, snapToObjects: true } as const;
export type DesignCanvasSettings = { readonly [Key in keyof typeof defaultDesignCanvasSettings]: boolean };
export type DesignCanvasSetting = keyof DesignCanvasSettings;

export const designBackgrounds = ['default', 'white', 'slate', 'charcoal'] as const;
export const designGrids = ['dots', 'lines', 'hidden'] as const;
export const designGridSpacingRange = { min: 12, max: 64, step: 4, initial: 32 } as const;
export const designAppearances = ['system', 'light', 'dark'] as const;
export const designToolbarPositions = ['side', 'bottom', 'top'] as const;

type DesignGrid = typeof designGrids[number];
type DesignGridPattern = Exclude<DesignGrid, 'hidden'>;
export type DesignToolbarPosition = typeof designToolbarPositions[number];
export type DesignCanvasPreferences = DesignCanvasSettings & Readonly<{
  background: typeof designBackgrounds[number];
  grid: DesignGrid;
  gridSpacing: Readonly<Record<DesignGridPattern, number>>;
  appearance: typeof designAppearances[number];
  toolbarPosition: DesignToolbarPosition;
  showLayerThumbnails: boolean;
}>;

type Preferences = DesignCanvasPreferences & Readonly<{ shortcuts: DesignShortcutOverrides }>;
const defaults: Preferences = {
  ...defaultDesignCanvasSettings,
  background: 'default', grid: 'dots',
  gridSpacing: { dots: designGridSpacingRange.initial, lines: designGridSpacingRange.initial },
  appearance: 'system', toolbarPosition: 'side', showLayerThumbnails: true, shortcuts: {},
};
const key = 'setsuna.design.canvas-settings';
let snapshot: Preferences | undefined;
let unsaved: Preferences | undefined;
const listeners = new Set<() => void>();

function choice<T extends string>(choices: readonly T[], value: T | undefined, fallback: T) {
  return value !== undefined && choices.includes(value) ? value : fallback;
}

function normalizeGridSpacing(value: unknown) {
  const { min, max, step, initial } = designGridSpacingRange;
  if (typeof value !== 'number' || !Number.isFinite(value)) return initial;
  return Math.min(max, Math.max(min, min + Math.round((value - min) / step) * step));
}

function readPreferences(): Preferences {
  if (unsaved) return unsaved;
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaults;
    const saved = JSON.parse(stored) as Partial<Preferences> | null;
    return {
      showPixelGrid: saved?.showPixelGrid === true,
      snapToPixelGrid: saved?.snapToPixelGrid === true,
      snapToObjects: saved?.snapToObjects !== false,
      background: choice(designBackgrounds, saved?.background, defaults.background),
      grid: choice(designGrids, saved?.grid, defaults.grid),
      gridSpacing: {
        dots: normalizeGridSpacing(saved?.gridSpacing?.dots),
        lines: normalizeGridSpacing(saved?.gridSpacing?.lines),
      },
      appearance: choice(designAppearances, saved?.appearance, defaults.appearance),
      toolbarPosition: choice(designToolbarPositions, saved?.toolbarPosition, defaults.toolbarPosition),
      showLayerThumbnails: saved?.showLayerThumbnails !== false,
      shortcuts: readDesignShortcutOverrides(saved?.shortcuts),
    };
  } catch { return defaults; }
}

function publish(next: Preferences) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== key) return;
  unsaved = undefined;
  publish(readPreferences());
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.removeEventListener('storage', onStorage);
    snapshot = undefined;
  };
}

function getSnapshot() {
  return snapshot ??= readPreferences();
}

function updatePreferences(update: (current: Preferences) => Preferences) {
  // Read the latest value before writing so another open window's changes are kept.
  const next = update(readPreferences());
  try {
    localStorage.setItem(key, JSON.stringify(next));
    unsaved = undefined;
  } catch { unsaved = next; }
  publish(next);
}

function setSetting<Key extends keyof DesignCanvasPreferences>(setting: Key, value: DesignCanvasPreferences[Key]) {
  updatePreferences((current) => ({ ...current, [setting]: value }));
}

function toggleSetting(setting: DesignCanvasSetting) {
  updatePreferences((current) => ({ ...current, [setting]: !current[setting] }));
}

function setGridSpacing(pattern: DesignGridPattern, spacing: number) {
  updatePreferences((current) => ({
    ...current, gridSpacing: { ...current.gridSpacing, [pattern]: normalizeGridSpacing(spacing) },
  }));
}

export function useDesignCanvasSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, () => defaults);
  return { settings, setSetting, toggleSetting, setGridSpacing };
}

export function useDesignShortcuts(shortcuts: DesignShortcutOverrides) {
  const platform = designShortcutPlatform();
  return useMemo(() => createDesignShortcuts(shortcuts, platform), [platform, shortcuts]);
}

export function useDesignShortcutSettings() {
  const { settings: { shortcuts } } = useDesignCanvasSettings();
  const effective = useDesignShortcuts(shortcuts);
  return {
    platform: effective.platform,
    bindingsFor: effective.bindingsFor,
    isOverridden: (id: DesignShortcutId) => Object.hasOwn(shortcuts, id),
    setBindings: (id: DesignShortcutId, bindings: readonly string[], conflict?: KeyboardShortcutConflict<DesignShortcutId>) =>
      updatePreferences((current) => {
        const next = { ...current.shortcuts, [id]: normalizeDesignBindings(bindings) };
        if (conflict) {
          const { bindingsFor } = createDesignShortcuts(current.shortcuts, effective.platform);
          next[conflict.commandId] = bindingsFor(conflict.commandId).filter((binding) => binding !== conflict.binding);
        }
        return { ...current, shortcuts: next };
      }),
    resetCommand: (id: DesignShortcutId) => updatePreferences((current) => ({
      ...current, shortcuts: restoreDesignShortcut(current.shortcuts, id, effective.platform),
    })),
    resetAll: () => updatePreferences((current) => ({ ...current, shortcuts: {} })),
  };
}
