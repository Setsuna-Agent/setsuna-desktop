import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultGitSettings, type GitSettings, type GitSettingsState } from '../../contracts/index.js';
import type { ReviewClient } from '../client.js';
import { useReviewRendererService } from '../context.js';

export function useGitSettings(client?: Pick<ReviewClient, 'readGitSettings' | 'updateGitSettings'>) {
  const service = useReviewRendererService();
  const settingsClient = client ?? service;
  const [settings, setSettings] = useState<GitSettingsState | null>(null);
  const [draft, setDraft] = useState<GitSettings>(defaultGitSettings);
  const [pending, setPending] = useState<'loading' | 'saving' | null>('loading');
  const [error, setError] = useState<'load' | 'save' | 'conflict' | null>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setPending('loading');
    setError(null);
    try {
      const current = await settingsClient.readGitSettings({ signal: abort.signal });
      if (abort.signal.aborted) return;
      setSettings(current);
      setDraft(current.settings);
    } catch {
      if (!abort.signal.aborted) setError('load');
    } finally {
      if (!abort.signal.aborted) { request.current = null; setPending(null); }
    }
  }, [settingsClient]);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);

  async function save(nextDraft = draft): Promise<boolean> {
    if (!settings || request.current || !nextDraft.commitMessagePrompt.trim() || !nextDraft.conflictResolutionPrompt.trim() || error === 'conflict') return false;
    const abort = new AbortController();
    request.current = abort;
    setPending('saving');
    setError(null);
    try {
      const saved = await settingsClient.updateGitSettings({ settings: nextDraft, expectedRevision: settings.revision }, { signal: abort.signal });
      if (abort.signal.aborted) return false;
      setSettings(saved);
      return true;
    } catch (cause) {
      // Keep the draft on failure; never silently retry against a newer settings revision.
      if (!abort.signal.aborted) setError(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'REVISION_CONFLICT' ? 'conflict' : 'save');
      return false;
    } finally {
      if (!abort.signal.aborted) { request.current = null; setPending(null); }
    }
  }

  return { draft, setDraft, pending, error, load, save, ready: settings !== null, availableModels: settings?.availableModels ?? [] };
}
