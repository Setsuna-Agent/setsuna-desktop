import { useCallback, useEffect, useMemo, useState } from 'react';

export type PluginPageSession = Readonly<{
  viewKey: string;
  cwd?: string;
  projectId?: string;
  threadId?: string;
}>;

/** Visit lazily, retain each page's last active context, and release revoked entries. */
export function usePluginPageSessions(availableViewKeys: readonly string[], selectedViewKey: string | null,
  context: Omit<PluginPageSession, 'viewKey'>): readonly PluginPageSession[] {
  const [stored, setStored] = useState<readonly PluginPageSession[]>([]);
  const availableSignature = JSON.stringify(availableViewKeys);
  const { cwd, projectId, threadId } = context;
  const sessions = useMemo(() => {
    const available = new Set<string>(JSON.parse(availableSignature));
    const next = stored.filter(session => available.has(session.viewKey));
    if (selectedViewKey && available.has(selectedViewKey)) {
      const index = next.findIndex(session => session.viewKey === selectedViewKey);
      const previous = next[index];
      if (!previous || previous.cwd !== cwd || previous.projectId !== projectId || previous.threadId !== threadId) {
        const session = { viewKey: selectedViewKey, cwd, projectId, threadId };
        if (index < 0) next.push(session);
        else next[index] = session;
      }
    }
    return next.length === stored.length && next.every((session, index) => session === stored[index]) ? stored : next;
  }, [availableSignature, cwd, projectId, selectedViewKey, stored, threadId]);
  useEffect(() => {
    if (sessions !== stored) setStored(sessions);
  }, [sessions, stored]);
  return sessions;
}

export function usePluginPageRefreshRequests() {
  const [requests, setRequests] = useState<Readonly<Record<string, number>>>({});
  const refresh = useCallback((viewKey: string) => {
    setRequests(current => ({ ...current, [viewKey]: (current[viewKey] ?? 0) + 1 }));
  }, []);
  return { requests, refresh };
}
