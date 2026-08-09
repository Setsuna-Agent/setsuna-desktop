import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareProviderForSave } from './provider-model.js';

const SETTINGS_AUTO_SAVE_DELAY_MS = 300;

export type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
};

export function idleSaveState(): SaveState {
  return { status: 'idle', message: '' };
}

export function useProviderAutoSave({
  apiKeysByProviderId,
  onSave,
  onSaveStateChange,
  providers,
  savedMessage,
  savingMessage,
}: {
  apiKeysByProviderId: Record<string, string>;
  onSave: (providers: ProviderConfigState[], apiKeysByProviderId: Record<string, string>) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
  providers: ProviderConfigState[];
  savedMessage: string;
  savingMessage: string;
}) {
  const [saveState, setSaveState] = useState<SaveState>(() => idleSaveState());
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const providersRef = useRef(providers);
  const apiKeysByProviderIdRef = useRef(apiKeysByProviderId);
  const latestDirtyRevisionRef = useRef(dirtyRevision);
  const saveRequestIdRef = useRef(0);
  const lastStartedRevisionRef = useRef(0);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const onSaveRef = useRef(onSave);

  providersRef.current = providers;
  apiKeysByProviderIdRef.current = apiKeysByProviderId;
  onSaveRef.current = onSave;

  useEffect(() => {
    onSaveStateChange(saveState);
  }, [onSaveStateChange, saveState]);

  const saveRevision = useCallback((revision: number) => {
    lastStartedRevisionRef.current = Math.max(lastStartedRevisionRef.current, revision);
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    if (mountedRef.current) setSaveState({ status: 'saving', message: savingMessage });
    return onSaveRef.current(providersRef.current.map(prepareProviderForSave), apiKeysByProviderIdRef.current)
      .then(() => {
        if (mountedRef.current && saveRequestIdRef.current === requestId && latestDirtyRevisionRef.current === revision) {
          setSaveState({ status: 'saved', message: savedMessage });
        }
      })
      .catch((error) => {
        if (mountedRef.current && saveRequestIdRef.current === requestId) {
          setSaveState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
  }, [savedMessage, savingMessage]);

  useEffect(() => {
    if (!dirtyRevision) return undefined;
    const revision = dirtyRevision;
    pendingSaveTimerRef.current = window.setTimeout(() => {
      pendingSaveTimerRef.current = null;
      void saveRevision(revision);
    }, SETTINGS_AUTO_SAVE_DELAY_MS);
    return () => {
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
    };
  }, [dirtyRevision, saveRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      const revision = latestDirtyRevisionRef.current;
      if (revision <= lastStartedRevisionRef.current) return;
      // Leaving settings must flush the latest draft instead of discarding the debounce window.
      lastStartedRevisionRef.current = revision;
      void onSaveRef.current(providersRef.current.map(prepareProviderForSave), apiKeysByProviderIdRef.current)
        .catch((error) => console.error('[settings] failed to flush provider settings during unmount', error));
    };
  }, []);

  return useCallback(() => {
    setSaveState({ status: 'saving', message: savingMessage });
    const nextRevision = latestDirtyRevisionRef.current + 1;
    latestDirtyRevisionRef.current = nextRevision;
    setDirtyRevision(nextRevision);
  }, [savingMessage]);
}
