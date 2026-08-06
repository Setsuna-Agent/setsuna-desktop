import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { normalizeKeyboardShortcutBinding } from './keyboardShortcutBindings.js';
import {
  KEYBOARD_SHORTCUT_PLATFORMS,
  isKeyboardShortcutCommandId,
  keyboardShortcutCommand,
  keyboardShortcutCommands,
  keyboardShortcutPlatform,
  type KeyboardShortcutCommandId,
  type KeyboardShortcutPlatform,
} from './keyboardShortcutCommands.js';

export const KEYBOARD_SHORTCUTS_STORAGE_KEY = 'setsuna-keyboard-shortcuts-v1';

export type KeyboardShortcutOverrides = Partial<Record<KeyboardShortcutCommandId, string[]>>;

export type StoredKeyboardShortcutPreferences = {
  version: 1;
  platforms: Partial<Record<KeyboardShortcutPlatform, KeyboardShortcutOverrides>>;
};

type KeyboardShortcutsContextValue = {
  platform: KeyboardShortcutPlatform;
  recording: boolean;
  bindingsFor: (commandId: KeyboardShortcutCommandId) => readonly string[];
  commandForBinding: (
    binding: string,
    exceptCommandId?: KeyboardShortcutCommandId,
  ) => KeyboardShortcutCommandId | null;
  isOverridden: (commandId: KeyboardShortcutCommandId) => boolean;
  resetAll: () => void;
  resetCommand: (commandId: KeyboardShortcutCommandId) => void;
  setBindings: (commandId: KeyboardShortcutCommandId, bindings: readonly string[]) => void;
  setRecording: (recording: boolean) => void;
};

const defaultPlatform: KeyboardShortcutPlatform = 'win32';
const defaultContext: KeyboardShortcutsContextValue = {
  platform: defaultPlatform,
  recording: false,
  bindingsFor: (commandId) => keyboardShortcutCommand(commandId).defaultBindings[defaultPlatform],
  commandForBinding: () => null,
  isOverridden: () => false,
  resetAll: () => undefined,
  resetCommand: () => undefined,
  setBindings: () => undefined,
  setRecording: () => undefined,
};

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue>(defaultContext);

export function KeyboardShortcutsProvider({
  children,
  initialPlatform,
}: PropsWithChildren<{ initialPlatform?: KeyboardShortcutPlatform }>) {
  const platform = initialPlatform ?? currentKeyboardShortcutPlatform();
  const [preferences, setPreferences] = useState<StoredKeyboardShortcutPreferences>(readKeyboardShortcutPreferences);
  const [recording, setRecording] = useState(false);
  const platformOverrides = preferences.platforms[platform] ?? {};

  const bindingsFor = useCallback((commandId: KeyboardShortcutCommandId): readonly string[] => {
    const override = platformOverrides[commandId];
    return override ?? keyboardShortcutCommand(commandId).defaultBindings[platform];
  }, [platform, platformOverrides]);

  const isOverridden = useCallback(
    (commandId: KeyboardShortcutCommandId) => Object.hasOwn(platformOverrides, commandId),
    [platformOverrides],
  );

  const setBindings = useCallback((commandId: KeyboardShortcutCommandId, bindings: readonly string[]) => {
    const normalized = normalizeBindingList(bindings);
    setPreferences((current) => ({
      version: 1,
      platforms: {
        ...current.platforms,
        [platform]: {
          ...(current.platforms[platform] ?? {}),
          [commandId]: normalized,
        },
      },
    }));
  }, [platform]);

  const resetCommand = useCallback((commandId: KeyboardShortcutCommandId) => {
    setPreferences((current) => resetKeyboardShortcutCommandPreferences(current, platform, commandId));
  }, [platform]);

  const resetAll = useCallback(() => {
    setPreferences((current) => ({
      version: 1,
      platforms: { ...current.platforms, [platform]: {} },
    }));
  }, [platform]);

  const commandForBinding = useCallback((
    binding: string,
    exceptCommandId?: KeyboardShortcutCommandId,
  ): KeyboardShortcutCommandId | null => {
    const normalizedBinding = normalizeKeyboardShortcutBinding(binding);
    if (!normalizedBinding) return null;
    for (const command of keyboardShortcutCommands) {
      if (command.id === exceptCommandId) continue;
      if (bindingsFor(command.id).some(
        (candidate) => normalizeKeyboardShortcutBinding(candidate) === normalizedBinding,
      )) return command.id;
    }
    return null;
  }, [bindingsFor]);

  useEffect(() => writeKeyboardShortcutPreferences(preferences), [preferences]);

  useEffect(() => {
    const setShortcutRecording = window.setsunaDesktop?.desktop.setKeyboardShortcutRecording;
    if (!setShortcutRecording) return undefined;
    void setShortcutRecording(recording).catch(() => undefined);
    return recording
      ? () => { void setShortcutRecording(false).catch(() => undefined); }
      : undefined;
  }, [recording]);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key !== KEYBOARD_SHORTCUTS_STORAGE_KEY) return;
      setPreferences(readKeyboardShortcutPreferences());
    };
    window.addEventListener('storage', syncPreferences);
    return () => window.removeEventListener('storage', syncPreferences);
  }, []);

  const value = useMemo<KeyboardShortcutsContextValue>(() => ({
    platform,
    recording,
    bindingsFor,
    commandForBinding,
    isOverridden,
    resetAll,
    resetCommand,
    setBindings,
    setRecording,
  }), [
    bindingsFor,
    commandForBinding,
    isOverridden,
    platform,
    recording,
    resetAll,
    resetCommand,
    setBindings,
  ]);

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts(): KeyboardShortcutsContextValue {
  return useContext(KeyboardShortcutsContext);
}

export function normalizeKeyboardShortcutPreferences(value: unknown): StoredKeyboardShortcutPreferences {
  const normalized: StoredKeyboardShortcutPreferences = { version: 1, platforms: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;
  const platforms = (value as { platforms?: unknown }).platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) return normalized;

  for (const platform of KEYBOARD_SHORTCUT_PLATFORMS) {
    const rawOverrides = (platforms as Record<string, unknown>)[platform];
    if (!rawOverrides || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) continue;
    const overrides: KeyboardShortcutOverrides = {};
    for (const [commandId, rawBindings] of Object.entries(rawOverrides)) {
      if (!isKeyboardShortcutCommandId(commandId) || !Array.isArray(rawBindings)) continue;
      overrides[commandId] = normalizeBindingList(rawBindings);
    }
    normalized.platforms[platform] = overrides;
  }
  return normalized;
}

export function resetKeyboardShortcutCommandPreferences(
  preferences: StoredKeyboardShortcutPreferences,
  platform: KeyboardShortcutPlatform,
  commandId: KeyboardShortcutCommandId,
): StoredKeyboardShortcutPreferences {
  const restoredBindings = new Set(keyboardShortcutCommand(commandId).defaultBindings[platform]);
  const nextOverrides = { ...(preferences.platforms[platform] ?? {}) };

  // Restoring a default binding must transfer it back from any command that
  // previously claimed it, otherwise runtime matching becomes ambiguous.
  for (const command of keyboardShortcutCommands) {
    if (command.id === commandId) continue;
    const currentBindings = nextOverrides[command.id] ?? command.defaultBindings[platform];
    const nextBindings = currentBindings.filter((binding) => !restoredBindings.has(binding));
    if (nextBindings.length !== currentBindings.length) nextOverrides[command.id] = nextBindings;
  }
  delete nextOverrides[commandId];

  return {
    version: 1,
    platforms: { ...preferences.platforms, [platform]: nextOverrides },
  };
}

export function readKeyboardShortcutPreferences(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): StoredKeyboardShortcutPreferences {
  if (!storage) return { version: 1, platforms: {} };
  try {
    const stored = storage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
    return stored ? normalizeKeyboardShortcutPreferences(JSON.parse(stored)) : { version: 1, platforms: {} };
  } catch {
    return { version: 1, platforms: {} };
  }
}

export function writeKeyboardShortcutPreferences(
  preferences: StoredKeyboardShortcutPreferences,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preference remains usable when a sandboxed surface denies storage.
  }
}

function normalizeBindingList(bindings: readonly unknown[]): string[] {
  return [...new Set(bindings.map(normalizeKeyboardShortcutBinding).filter(Boolean) as string[])];
}

function currentKeyboardShortcutPlatform(): KeyboardShortcutPlatform {
  if (typeof window === 'undefined') return defaultPlatform;
  const detected = window.setsunaDesktop?.desktop.platform ?? navigator.platform.toLowerCase();
  if (detected === 'darwin' || detected.includes('mac')) return 'darwin';
  if (detected === 'linux' || detected.includes('linux')) return 'linux';
  return keyboardShortcutPlatform(detected);
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
