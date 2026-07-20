import { useEffect, useRef, useState } from 'react';
import type { DesktopRuntimeClient, RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';
import { ConversationBackgroundServiceList } from './ConversationBackgroundServiceList.js';

const BACKGROUND_SERVICE_POLL_INTERVAL_MS = 2_000;

export type BackgroundShellProcessClient = Pick<
  DesktopRuntimeClient,
  'listBackgroundShellProcesses' | 'terminateBackgroundShellProcess'
>;

export function ConversationBackgroundServices({
  client,
  threadId,
}: {
  client: BackgroundShellProcessClient;
  threadId: string;
}) {
  const [processes, setProcesses] = useState<RuntimeBackgroundShellProcess[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [terminatingIds, setTerminatingIds] = useState<Set<string>>(() => new Set());
  const activeThreadIdRef = useRef(threadId);
  const stateRevisionRef = useRef(0);

  useEffect(() => {
    activeThreadIdRef.current = threadId;
    stateRevisionRef.current += 1;
    setProcesses([]);
    setTerminatingIds(new Set());
    setError(null);

    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      const revision = stateRevisionRef.current;
      try {
        const result = await client.listBackgroundShellProcesses(threadId);
        if (!cancelled && revision === stateRevisionRef.current) {
          setProcesses(result.processes);
          setError(null);
        }
      } catch (unknownError) {
        if (!cancelled && revision === stateRevisionRef.current) {
          setError(errorMessage(unknownError));
        }
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(poll, BACKGROUND_SERVICE_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (activeThreadIdRef.current === threadId) activeThreadIdRef.current = '';
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [client, threadId]);

  const terminate = async (processId: string) => {
    const requestedThreadId = threadId;
    stateRevisionRef.current += 1;
    setTerminatingIds((current) => new Set(current).add(processId));
    try {
      await client.terminateBackgroundShellProcess(requestedThreadId, processId);
      if (activeThreadIdRef.current !== requestedThreadId) return;
      stateRevisionRef.current += 1;
      setProcesses((current) => current.filter((process) => process.id !== processId));
      setError(null);
    } catch (unknownError) {
      if (activeThreadIdRef.current === requestedThreadId) setError(errorMessage(unknownError));
    } finally {
      if (activeThreadIdRef.current === requestedThreadId) {
        setTerminatingIds((current) => {
          const next = new Set(current);
          next.delete(processId);
          return next;
        });
      }
    }
  };

  if (!processes.length) return null;
  return (
    <>
      <div className="chat-conversation-overview-panel__divider" />
      <ConversationBackgroundServiceList
        error={error}
        processes={processes}
        terminatingIds={terminatingIds}
        onTerminate={terminate}
      />
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
