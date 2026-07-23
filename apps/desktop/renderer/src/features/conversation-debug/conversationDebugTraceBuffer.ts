import type {
  RuntimeDebugTraceEvent,
  RuntimeDebugTraceList,
} from '@setsuna-desktop/contracts';

/**
 * Applies one incremental trace page and enforces the server's retention
 * watermark on the client-side buffer.
 */
export function mergeConversationDebugTracePage(
  tracesBySequence: Map<number, RuntimeDebugTraceEvent>,
  page: RuntimeDebugTraceList,
  previousDroppedBeforeSeq?: number,
): number | undefined {
  for (const trace of page.traces) {
    const current = tracesBySequence.get(trace.seq);
    if (!current || current.id === trace.id) {
      tracesBySequence.set(trace.seq, trace);
    }
  }

  const droppedBeforeSeq = maxDefined(
    previousDroppedBeforeSeq,
    page.droppedBeforeSeq,
  );
  if (droppedBeforeSeq !== undefined) {
    for (const sequence of tracesBySequence.keys()) {
      if (sequence <= droppedBeforeSeq) tracesBySequence.delete(sequence);
    }
  }
  return droppedBeforeSeq;
}

function maxDefined(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}
