import {
  browserLocalStorage,
  readStorageValue,
  type StorageReader,
  type StorageWriter,
  writeStorageValue,
} from '../../../shared/preferences/browserStorage.js';
import type { ChatThinkingSelection } from './chatComposerModeState.js';

export const CHAT_THINKING_PREFERENCES_STORAGE_KEY = 'setsuna.chat.thinkingPreferences.v1';

type ChatThinkingPreferenceStorage = StorageReader & Pick<StorageWriter, 'setItem'>;
type ChatThinkingPreferences = Record<string, ChatThinkingSelection>;

export function readChatThinkingPreference(
  modelKey: string,
  storage: StorageReader | null = browserLocalStorage(),
): ChatThinkingSelection | null {
  if (!modelKey) return null;
  const preferences = parseChatThinkingPreferences(
    readStorageValue(storage, CHAT_THINKING_PREFERENCES_STORAGE_KEY),
  );
  return preferences[modelKey] ?? null;
}

export function writeChatThinkingPreference(
  modelKey: string,
  selection: ChatThinkingSelection,
  storage: ChatThinkingPreferenceStorage | null = browserLocalStorage(),
): boolean {
  if (!modelKey || !storage) return false;
  const preferences = parseChatThinkingPreferences(
    readStorageValue(storage, CHAT_THINKING_PREFERENCES_STORAGE_KEY),
  );
  preferences[modelKey] = selection;
  return writeStorageValue(
    storage,
    CHAT_THINKING_PREFERENCES_STORAGE_KEY,
    JSON.stringify(preferences),
  );
}

function parseChatThinkingPreferences(value: string | null): ChatThinkingPreferences {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const preferences: ChatThinkingPreferences = {};
    for (const [modelKey, selection] of Object.entries(parsed)) {
      if (!isChatThinkingSelection(selection)) continue;
      preferences[modelKey] = selection;
    }
    return preferences;
  } catch {
    return {};
  }
}

function isChatThinkingSelection(value: unknown): value is ChatThinkingSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  return typeof selection.enabled === 'boolean' && typeof selection.effort === 'string';
}
