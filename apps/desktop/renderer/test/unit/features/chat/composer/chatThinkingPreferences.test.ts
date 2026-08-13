import { describe, expect, it } from 'vitest';
import {
  CHAT_THINKING_PREFERENCES_STORAGE_KEY,
  readChatThinkingPreference,
  writeChatThinkingPreference,
} from '../../../../../src/features/chat/composer/chatThinkingPreferences.js';

describe('chat thinking preferences', () => {
  it('remembers thinking selections independently for each model', () => {
    const storage = createMemoryStorage();

    expect(writeChatThinkingPreference(
      'provider-a/model-a',
      { enabled: true, effort: 'xhigh' },
      storage,
    )).toBe(true);
    expect(writeChatThinkingPreference(
      'provider-a/model-b',
      { enabled: false, effort: 'max' },
      storage,
    )).toBe(true);

    expect(readChatThinkingPreference('provider-a/model-a', storage)).toEqual({
      enabled: true,
      effort: 'xhigh',
    });
    expect(readChatThinkingPreference('provider-a/model-b', storage)).toEqual({
      enabled: false,
      effort: 'max',
    });
  });

  it('ignores corrupt and invalid saved entries', () => {
    const storage = createMemoryStorage();
    storage.setItem(CHAT_THINKING_PREFERENCES_STORAGE_KEY, JSON.stringify({
      invalid: { enabled: 'yes', effort: 'max' },
      valid: { enabled: true, effort: 'high' },
    }));

    expect(readChatThinkingPreference('invalid', storage)).toBeNull();
    expect(readChatThinkingPreference('valid', storage)).toEqual({
      enabled: true,
      effort: 'high',
    });

    storage.setItem(CHAT_THINKING_PREFERENCES_STORAGE_KEY, '{bad json');
    expect(readChatThinkingPreference('valid', storage)).toBeNull();
  });
});

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
