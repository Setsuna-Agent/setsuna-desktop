import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTurnNavigationRequest } from '@setsuna-desktop/renderer-contracts/chat';
import type { AutomationSnapshot, AutomationTask } from '../contracts/index.js';
import type { AutomationClient } from './client.js';
import { automationActivity } from './activity.js';

export function useAutomationPage(client: AutomationClient, currentThreadId: string | undefined, openConversation: (threadId: string) => Promise<boolean>) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>({ tasks: [], models: [], projects: [] });
  // Reused execution conversations can contain multiple runs; selection belongs to a run, not its thread.
  const [selection, setSelection] = useState<{
    taskId: string | null; runId: string | null; threadId: string; requestId: number;
  } | null>(null);
  const conversationId = selection?.threadId ?? null;
  const selectedRunId = selection?.runId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const requests = useRef(0);
  const openRef = useRef(openConversation);
  openRef.current = openConversation;
  const initialThreadRef = useRef(currentThreadId);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const state = await client.snapshot(signal);
    if (!signal?.aborted) setSnapshot(state);
    return state;
  }, [client]);

  const select = useCallback(async (threadId: string, taskId: string | null, runId: string | null = null) => {
    const request = ++requests.current;
    setBusy(true); setError(null);
    try {
      if (await openRef.current(threadId) && request === requests.current) {
        setSelection({ taskId, runId, threadId, requestId: request });
      }
    } catch (error) { if (request === requests.current) setError(errorMessage(error)); }
    finally { if (request === requests.current) setBusy(false); }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let fetching = false;
    const load = async (initialize: boolean) => {
      if (fetching) return;
      fetching = true;
      try {
        const state = await refresh(abort.signal);
        if (initialize && !abort.signal.aborted) {
          const task = state.tasks.find((task) => task.conversationThreadId === initialThreadRef.current || task.runs.some((run) => run.threadId === initialThreadRef.current));
          const threadId = task?.conversationThreadId ?? state.draftThreadId ?? state.tasks[0]?.conversationThreadId
            ?? (await client.createConversation()).threadId;
          if (!abort.signal.aborted) await select(threadId, task?.id ?? state.tasks.find((item) => item.conversationThreadId === threadId)?.id ?? null);
        }
      } catch (error) { if (!abort.signal.aborted) setError(errorMessage(error)); }
      finally { fetching = false; }
    };
    void load(true);
    const timer = setInterval(() => { void load(false); }, 3_000);
    return () => { abort.abort(); clearInterval(timer); requests.current += 1; };
  }, [client, refresh, select, reload]);

  const newConversation = useCallback(async () => {
    setBusy(true); setError(null);
    try { const created = await client.createConversation(); await refresh(); await select(created.threadId, null); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }, [client, refresh, select]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const retry = () => {
    setError(null);
    if (conversationId) void perform(async () => undefined);
    else setReload((current) => current + 1);
  };
  // A task created by the agent appears without requiring a page reload.
  const selectedTask: AutomationTask | undefined = snapshot.tasks.find((task) => task.id === selection?.taskId)
    ?? [...snapshot.tasks].reverse().find((task) => task.conversationThreadId === conversationId);
  const selectedRun = selectedTask?.runs.find((run) => run.id === selectedRunId);
  const turnNavigationRequest: ChatTurnNavigationRequest | undefined = selection && selectedRun?.turnId
    ? { requestId: selection.requestId, threadId: selection.threadId, turnId: selectedRun.turnId }
    : undefined;
  const activity = useMemo(() => automationActivity(snapshot.tasks), [snapshot.tasks]);

  return { snapshot, selectedTask, selectedRunId, turnNavigationRequest, activity, conversationId, error, busy, select, newConversation, refresh, perform, retry };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
