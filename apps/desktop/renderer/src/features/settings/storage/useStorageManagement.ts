import type { DesktopStorageUsage, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createDesktopRuntimeClient } from '../../../services/runtime-client/client.js';
import { isPrimaryConversationThread } from '../../../services/runtime-client/runtimeThreadRelations.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { cleanStorageSelection, type StorageCleanupSelection } from './storageCleanup.js';

export function useStorageManagement() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<DesktopStorageUsage | null>(null);
  const [threads, setThreads] = useState<RuntimeThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const api = window.setsunaDesktop?.dataRoot;
      if (!api?.getStorageUsage) throw new Error(t('storage.unavailable'));
      const [nextUsage, nextThreads] = await Promise.allSettled([
        api.getStorageUsage(),
        Promise.resolve().then(() => createDesktopRuntimeClient().listThreads({ includeArchived: true })),
      ]);
      if (version !== requestVersion.current) return;
      setUsage(nextUsage.status === 'fulfilled' ? nextUsage.value : null);
      const conversations = nextThreads.status === 'fulfilled' ? nextThreads.value.threads.filter(isPrimaryConversationThread) : [];
      setThreads(conversations);
      if (nextUsage.status === 'rejected' || nextThreads.status === 'rejected') setError(t('storage.loadError'));
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : t('storage.loadError'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  const cleanup = async (selection: StorageCleanupSelection) => {
    if (running.current) return null;
    running.current = true;
    setWorking(true);
    setError(null);
    try {
      const result = await cleanStorageSelection(createDesktopRuntimeClient(), window.setsunaDesktop!.dataRoot, selection);
      if (result.failedThreadIds.length || (!result.cancelled && result.remainingCategories.length)) {
        setError(t('storage.cleanupError'));
      }
      await refresh();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('storage.cleanupError'));
      return null;
    } finally {
      running.current = false;
      setWorking(false);
    }
  };

  return { usage, threads, loading, working, error, cleanup, refresh: () => { setError(null); void refresh(); } };
}
