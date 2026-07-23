import type {
  RuntimeDebugTraceEvent,
  RuntimeDebugTraceInput,
  RuntimeDebugTraceList,
} from '@setsuna-desktop/contracts';

export type RuntimeDebugTraceSink = {
  append(input: RuntimeDebugTraceInput): RuntimeDebugTraceEvent;
};

export type RuntimeDebugTraceStore = RuntimeDebugTraceSink & {
  list(threadId: string, afterSeq?: number): RuntimeDebugTraceList;
};

/**
 * Debug observability must never change a turn's behavior. Keep sink failures
 * outside the model, compaction, and tool execution paths they describe.
 */
export function appendRuntimeDebugTraceSafely(
  sink: RuntimeDebugTraceSink | undefined,
  input: RuntimeDebugTraceInput,
): void {
  if (!sink) return;
  try {
    sink.append(input);
  } catch {
    // The trace is intentionally best-effort and memory-only.
  }
}
