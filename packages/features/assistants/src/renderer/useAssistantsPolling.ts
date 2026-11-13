import { useEffect, useState } from 'react';
import type { AssistantsRendererService } from './client.js';
import { errorMessage } from './errors.js';
import { useAssistantsSnapshot } from './store.js';

/** Visible assistant surfaces share the snapshot; only one surface owns polling at a time. */
export function useAssistantsPolling(service: AssistantsRendererService, enabled = true) {
  const snapshot = useAssistantsSnapshot(service.store);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const load = () => service.store.refresh(abort.signal).then(() => {
      if (!abort.signal.aborted) setLoadError(null);
    }, (cause: unknown) => {
      // A failed poll keeps the last good snapshot available.
      if (!abort.signal.aborted && !service.store.getSnapshot()) setLoadError(errorMessage(cause));
    });
    void load();
    const timer = setInterval(() => { void load(); }, 3_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [enabled, service, reload]);
  return { snapshot, loadError, retry: () => setReload((value) => value + 1) };
}
