import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../providers/ToastProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../shared/preferences/browserStorage.js';

export function useStoredSidebarIds(storageKey: string, saveError: MessageKey) {
  const [ids, setIds] = useState(() => readIds(storageKey));
  const { t } = useI18n();
  const toast = useToast();
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setIds(readIds(storageKey));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);

  const toggle = useCallback((id: string) => {
    // Read the latest stored IDs in case another window's storage event is still pending.
    const current = readIds(storageKey);
    const next = current.has(id) ? new Set([...current].filter((item) => item !== id)) : new Set([id, ...current]);
    if (!writeBrowserStorageValue(storageKey, JSON.stringify([...next]))) {
      toast.error(t(saveError));
      return;
    }
    setIds(next);
  }, [saveError, storageKey, t, toast]);

  return { ids, toggle };
}

function readIds(storageKey: string): Set<string> {
  try {
    const value: unknown = JSON.parse(readBrowserStorageValue(storageKey) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : []);
  } catch { return new Set(); }
}
