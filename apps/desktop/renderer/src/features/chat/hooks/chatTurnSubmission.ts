import type {
  DesktopRuntimeClient,
  RuntimeThread,
} from '@setsuna-desktop/contracts';

export type ReconciledChatTurnSubmission = {
  kind: 'message' | 'queued';
  thread: RuntimeThread;
};

type ChatTurnReconciliationOptions = {
  attempts?: number;
  delayMs?: number;
};

export function createChatTurnClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `composer_${uuid}`;
  return `composer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function findChatTurnSubmission(
  thread: RuntimeThread,
  clientId: string,
): ReconciledChatTurnSubmission | null {
  if (thread.messages.some((message) => message.clientId === clientId)) {
    return { kind: 'message', thread };
  }
  if (thread.queuedTurnInputs?.some((input) => input.clientId === clientId)) {
    return { kind: 'queued', thread };
  }
  return null;
}

/**
 * A mutating request must not be blindly retried after losing its response: the
 * runtime may already have accepted it. Reconcile by the client-generated ID
 * against durable thread state before surfacing an ambiguous transport failure.
 */
export async function reconcileChatTurnSubmission(
  client: Pick<DesktopRuntimeClient, 'getThread'>,
  threadId: string,
  clientId: string,
  options: ChatTurnReconciliationOptions = {},
): Promise<ReconciledChatTurnSubmission | null> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const delayMs = Math.max(0, options.delayMs ?? 100);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const thread = await client.getThread(threadId);
      const submission = findChatTurnSubmission(thread, clientId);
      if (submission) return submission;
    } catch {
      // Preserve the original mutating-request error if reconciliation also fails.
    }
    if (attempt < attempts) await reconciliationDelay(delayMs);
  }
  return null;
}

function reconciliationDelay(delayMs: number): Promise<void> {
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
