import type { RuntimeActiveTurnState, RuntimeThreadSummary, ThreadQuery } from '@setsuna-desktop/contracts';
import type { RuntimeContainer } from '../runtime-factory.js';

/** Enrich the existing summary query without reading conversation histories. */
export async function listRuntimeThreadSummaries(
  runtime: Pick<RuntimeContainer, 'threadStore' | 'agentLoop' | 'approvalGate'>,
  query: ThreadQuery,
): Promise<RuntimeThreadSummary[]> {
  const threads = await runtime.threadStore.listThreads(query);
  const activeTurns = new Map(threads.flatMap((thread) => {
    const turnId = runtime.agentLoop.activeTurnId(thread.id);
    return turnId ? [[thread.id, turnId] as const] : [];
  }));
  const waitingStates = new Map<string, RuntimeActiveTurnState>();
  // Idle startup has no approval work. During a turn, one in-memory read serves the entire list.
  if (activeTurns.size) {
    const { approvals } = await runtime.approvalGate.listApprovals();
    for (const approval of approvals) {
      if (approval.status !== 'pending' || approval.reviewer === 'automatic'
        || activeTurns.get(approval.threadId) !== approval.turnId) continue;
      const state = approval.userInput || approval.elicitation ? 'waiting_for_input' : 'waiting_for_approval';
      if (state === 'waiting_for_input' || !waitingStates.has(approval.threadId)) {
        waitingStates.set(approval.threadId, state);
      }
    }
  }
  return threads.map((thread) => ({
    ...thread,
    activeTurnId: activeTurns.get(thread.id) ?? null,
    activeTurnState: activeTurns.has(thread.id) ? waitingStates.get(thread.id) ?? 'running' : null,
  }));
}
