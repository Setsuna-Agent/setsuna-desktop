import { useCallback, useEffect, useRef, useState } from 'react';
import { isWorkspaceBackgroundFile, prepareWorkspaceBackground, readWorkspaceBackground,
  WORKSPACE_BACKGROUND_CHANNEL, writeWorkspaceBackground } from './workspaceBackground.js';
import { useWorkspaceBackgroundTransparency } from './useWorkspaceBackgroundTransparency.js';

export function useWorkspaceBackground(onError: (reason: 'invalid' | 'save') => void) {
  const { transparency, setTransparency } = useWorkspaceBackgroundTransparency(() => onError('save'));
  const [image, setImage] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(() => {
    const version = ++revision.current;
    void readWorkspaceBackground().then((value) => {
      if (mounted.current && revision.current === version) setImage(value);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const updates = new BroadcastChannel(WORKSPACE_BACKGROUND_CHANNEL);
    updates.onmessage = refresh;
    return () => {
      mounted.current = false;
      revision.current += 1;
      updates.close();
    };
  }, [refresh]);
  useEffect(() => {
    const objectUrl = image ? URL.createObjectURL(image) : null;
    setUrl(objectUrl);
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image]);

  const change = async (file: File | null) => {
    if (pending.current) return;
    if (file && !isWorkspaceBackgroundFile(file)) { onError('invalid'); return; }
    pending.current = true;
    setBusy(true);
    try {
      const next = file ? await prepareWorkspaceBackground(file) : null;
      await writeWorkspaceBackground(next);
      if (mounted.current) {
        // A slow initial read must not overwrite a later user choice or reset.
        revision.current += 1;
        setImage(next);
      }
    } catch { if (mounted.current) onError('save'); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { url, busy, change, transparency, setTransparency };
}
