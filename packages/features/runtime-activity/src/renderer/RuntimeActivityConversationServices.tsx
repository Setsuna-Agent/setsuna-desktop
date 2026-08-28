import type { RuntimeBackgroundShellProcess } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useEffect, useRef, useState } from 'react';
import type { RuntimeActivityRendererService } from '../contracts/index.js';
import { RuntimeActivityConversationServiceList } from './RuntimeActivityConversationServiceList.js';
import './runtime-activity.css';

const CONVERSATION_SERVICE_POLL_INTERVAL_MS = 2_000;

export type RuntimeActivityConversationServicesProps = Readonly<{
  service: RuntimeActivityRendererService;
  threadId: string;
  translate: RendererTranslate;
}>;

export function RuntimeActivityConversationServices({
  service,
  threadId,
  translate,
}: RuntimeActivityConversationServicesProps) {
  const [services, setServices] = useState<readonly RuntimeBackgroundShellProcess[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(() => new Set());
  const activeThreadIdRef = useRef(threadId);
  const stateRevisionRef = useRef(0);
  activeThreadIdRef.current = threadId;

  useEffect(() => {
    stateRevisionRef.current += 1;
    setServices([]);
    setStoppingIds(new Set());
    setError(null);

    let cancelled = false;
    let timeoutId: number | undefined;
    const requestAbort = new AbortController();
    const poll = async () => {
      const revision = stateRevisionRef.current;
      try {
        const result = await service.listServices(
          { threadId },
          { signal: requestAbort.signal },
        );
        if (!cancelled && revision === stateRevisionRef.current) {
          setServices(result.services);
          setError(null);
        }
      } catch (unknownError) {
        if (!cancelled && revision === stateRevisionRef.current) {
          setError(errorMessage(unknownError));
        }
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(poll, CONVERSATION_SERVICE_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      requestAbort.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [service, threadId]);

  const stop = async (processId: string) => {
    const requestedThreadId = threadId;
    stateRevisionRef.current += 1;
    setStoppingIds((current) => new Set(current).add(processId));
    try {
      await service.stopService({ processId, threadId: requestedThreadId });
      if (activeThreadIdRef.current !== requestedThreadId) return;
      stateRevisionRef.current += 1;
      setServices((current) => current.filter((process) => process.id !== processId));
      setError(null);
    } catch (unknownError) {
      if (activeThreadIdRef.current === requestedThreadId) {
        setError(errorMessage(unknownError));
      }
    } finally {
      if (activeThreadIdRef.current === requestedThreadId) {
        setStoppingIds((current) => {
          const next = new Set(current);
          next.delete(processId);
          return next;
        });
      }
    }
  };

  if (!services.length) return null;
  return (
    <>
      <div className="runtime-activity-conversation-services__divider" />
      <RuntimeActivityConversationServiceList
        error={error}
        services={services}
        stoppingIds={stoppingIds}
        translate={translate}
        onStop={stop}
      />
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
