import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanDesignStorageResources, designStorageResourceKey, listDesignStorageResources,
  type DesignClient, type DesignStorageResource } from '../../../composition/design/DesignFeatureBoundary.js';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function useDesignStorageCleanup(client: DesignClient, onChange: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const lifetime = useRef<AbortController>();
  const busy = useRef(false);
  const [inventory, setInventory] = useState<Awaited<ReturnType<typeof listDesignStorageResources>>>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const next = await listDesignStorageResources(client, signal);
      if (signal.aborted) return;
      setInventory(next);
      const available = new Set(next.resources.map(designStorageResourceKey));
      setSelected((keys) => new Set([...keys].filter((key) => available.has(key))));
    } catch {
      if (signal.aborted) return;
      setInventory(undefined);
      setSelected(new Set());
      toast.error(t('storage.designLoadError'));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [client, t, toast]);

  useEffect(() => {
    const request = new AbortController();
    lifetime.current = request;
    busy.current = false;
    setWorking(false);
    setSelected(new Set());
    void load(request.signal);
    return () => request.abort();
  }, [load]);

  async function clean() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy.current || loading || !inventory) return;
    busy.current = true;
    setWorking(true);
    try {
      const chosen = inventory.resources.filter((item) => selected.has(designStorageResourceKey(item)));
      const failed = await cleanDesignStorageResources(client, chosen, signal);
      if (signal.aborted) return;
      setSelected(failed);
      if (failed.size) toast.error(t('storage.designCleanupError'));
      onChange();
      // Deleting a draft can make previously shared assets available for a new selection.
      await load(signal);
    } catch {
      if (!signal.aborted) toast.error(t('storage.designCleanupError'));
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setWorking(false);
      }
    }
  }

  function toggle(items: readonly DesignStorageResource[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of items) {
        const key = designStorageResourceKey(item);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }
  return { inventory, loading, working, selected, toggle, clean,
    retry: () => { if (lifetime.current) void load(lifetime.current.signal); } };
}
