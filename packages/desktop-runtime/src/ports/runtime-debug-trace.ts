import type {
  ConversationDebugTraceSink,
  RuntimeDebugTraceInput,
} from '@setsuna-desktop/feature-conversation-debug/contracts';

export type RuntimeDebugTraceSink = ConversationDebugTraceSink;

export function runtimeDebugTraceEnabled(sink: RuntimeDebugTraceSink | undefined): boolean {
  try {
    return sink?.enabled() === true;
  } catch {
    return false;
  }
}

/**
 * Debug observability must never change a turn's behavior. Keep sink failures
 * outside the model, compaction, and tool execution paths they describe.
 */
export function appendRuntimeDebugTraceSafely(
  sink: RuntimeDebugTraceSink | undefined,
  input: RuntimeDebugTraceInput,
): void {
  if (!sink || !runtimeDebugTraceEnabled(sink)) return;
  try {
    sink.append(input);
  } catch {
    // The trace is intentionally best-effort and memory-only.
  }
}
