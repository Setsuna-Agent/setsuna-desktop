import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { adoptOwnedThreadSnapshot } from '../../../services/runtime-client/runtimeThreadState.js';

export function useThreadWorkspaceRecovery({ client, threadId, setCurrentThread, reloadThreads }: {
  client: Pick<DesktopRuntimeClient, 'updateThread'>;
  threadId: string;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  reloadThreads(): Promise<unknown>;
}) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const recover = async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setFailed(false);
    try {
      const updated = await client.updateThread(threadId, { workspaceId: null });
      // A late response may refresh the list, but must not replace a newly selected conversation.
      setCurrentThread((current) => adoptOwnedThreadSnapshot(current, threadId, updated));
      await reloadThreads();
    } catch {
      setFailed(true);
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return { pending, failed, recover };
}
