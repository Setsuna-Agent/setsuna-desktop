import type { DesktopStorageUsage, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createDesktopRuntimeClient } from '../../../services/runtime-client/client.js';
import { isPrimaryConversationThread } from '../../../services/runtime-client/runtimeThreadRelations.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { cleanStorageSelection, type StorageCleanupSelection } from './storageCleanup.js';
import { readStorageUsageCache, refreshStorageUsageCache } from './storageUsageCache.js';

export function useStorageManagement(dataRoot?: string) {
  const { t } = useI18n();
  const [usage, setUsage] = useState<DesktopStorageUsage | null>(() => readStorageUsageCache(dataRoot));
  const [threads, setThreads] = useState<RuntimeThreadSummary[] | null>(null);
  const [loading, setLoading] = useState(Boolean(dataRoot));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const running = useRef(false);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (!dataRoot || !mounted.current) return;
    const version = ++requestVersion.current;
    setLoading(true);
    const current = () => version === requestVersion.current;
    const loadUsage = async () => {
      try {
        const api = window.setsunaDesktop?.dataRoot;
        if (!api?.getStorageUsage) throw new Error(t('storage.unavailable'));
        const next = await refreshStorageUsageCache(dataRoot, () => api.getStorageUsage());
        if (!current()) return;
        setUsage(next);
      } catch (reason) {
        if (current()) setError(reason instanceof Error ? reason.message : t('storage.loadError'));
      } finally {
        if (current()) setLoading(false);
      }
    };
    const loadThreads = async () => {
      try {
        const next = await createDesktopRuntimeClient().listThreads({ includeArchived: true });
        if (current()) setThreads(next.threads.filter(isPrimaryConversationThread));
      } catch {
        if (current()) setError(t('storage.loadError'));
      }
    };
    // A full disk scan must not delay the history picker, nor vice versa.
    await Promise.all([loadUsage(), loadThreads()]);
  }, [dataRoot, t]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; requestVersion.current += 1; };
  }, [refresh]);

  const cleanup = async (selection: StorageCleanupSelection) => {
    if (running.current) return null;
    running.current = true;
    setWorking(true);
    setError(null);
    try {
      const result = await cleanStorageSelection(createDesktopRuntimeClient(), window.setsunaDesktop!.dataRoot, selection);
      if (!mounted.current) return result;
      setThreads((current) => current?.filter((thread) => !result.deletedThreadIds.includes(thread.id)) ?? null);
      if (result.failedThreadIds.length || (!result.cancelled && result.remainingCategories.length)) {
        setError(t('storage.cleanupError'));
      }
      // Deletion has completed; recount in the background without keeping the dialog locked.
      void refresh();
      return result;
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : t('storage.cleanupError'));
      return null;
    } finally {
      running.current = false;
      if (mounted.current) setWorking(false);
    }
  };

  return { usage, threads: threads ?? [], threadsReady: threads !== null, loading, working, error, cleanup,
    refresh: () => { setError(null); void refresh(); } };
}
