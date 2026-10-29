import { useEffect, useRef, useState } from 'react';
import type { CollaborationAgentSettings, CollaborationSettingsState } from '../contracts/index.js';
import type { CollaborationClient } from './client.js';

export function useCollaborationSettings(client: Pick<CollaborationClient, 'readSettings' | 'updateSettings'>) {
  const [state, setState] = useState<CollaborationSettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ id: number; message: string } | null>(null);
  const inFlight = useRef(false);
  const errorId = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    void client.readSettings({ signal: abort.signal }).then((next) => {
      if (!abort.signal.aborted) setState(next);
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setError({ id: ++errorId.current, message: error instanceof Error ? error.message : String(error) });
    });
    return () => abort.abort();
  }, [client]);
  async function save(settings: CollaborationAgentSettings): Promise<boolean> {
    if (!state || inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const next = await client.updateSettings({ expectedRevision: state.revision, settings });
      setState(next);
      return true;
    } catch (error) {
      setError({ id: ++errorId.current, message: error instanceof Error ? error.message : String(error) });
      // The role dialog owns its draft; refresh confirmed settings for a deliberate retry.
      try { setState(await client.readSettings()); } catch { /* Keep the original failure. */ }
      return false;
    } finally { inFlight.current = false; setSaving(false); }
  }
  return { state, saving, error, save };
}
