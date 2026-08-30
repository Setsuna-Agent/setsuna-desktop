import type { RendererPluginRuntime } from './runtime.js';
import {
  emptyRendererLayoutPreferences,
  type RendererLayoutPreferenceStore,
  type RendererLayoutPreferencesV1,
} from './layout-preferences.js';

export interface RendererLayoutPreferenceController {
  get(): RendererLayoutPreferencesV1;
  reset(): Promise<void>;
  update(preferences: RendererLayoutPreferencesV1): Promise<void>;
}

export function createRendererLayoutPreferenceController(
  runtime: RendererPluginRuntime,
  store: RendererLayoutPreferenceStore,
): RendererLayoutPreferenceController {
  let queue: Promise<void> = Promise.resolve();
  const serialize = (operation: () => Promise<void>): Promise<void> => {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  };
  const commit = (
    next: RendererLayoutPreferencesV1,
    persist: () => void,
  ) => serialize(async () => {
    const previous = runtime.getPreferences();
    await runtime.updatePreferences(next);
    try {
      persist();
    } catch (error) {
      await runtime.updatePreferences(previous);
      throw error;
    }
  });

  return Object.freeze({
    get: () => runtime.getPreferences(),
    reset: () => commit(emptyRendererLayoutPreferences(), () => store.clear()),
    update: (next: RendererLayoutPreferencesV1) => commit(next, () => store.save(next)),
  });
}
