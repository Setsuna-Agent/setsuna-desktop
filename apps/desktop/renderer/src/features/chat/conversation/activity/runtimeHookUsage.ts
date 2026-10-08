import type { RuntimeHookRun, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { createRuntimePluginUseAnchors, type RuntimePluginUseAnchor } from '../../plugin-usage/runtimePluginUsageAnchor.js';

export type RuntimeHookUse = {
  run: RuntimeHookRun;
  anchor?: RuntimePluginUseAnchor;
};

/** Storage ownership does not determine where a Hook ran in the conversation. */
export function runtimeHookUsesByTurn(
  thread: RuntimeThread | null,
  previous: Map<string, RuntimeHookUse[]> = new Map(),
): Map<string, RuntimeHookUse[]> {
  if (!thread) return new Map();
  let anchors: ReturnType<typeof createRuntimePluginUseAnchors> | undefined;
  const collected = new Map<string, Map<string, RuntimeHookUse>>();
  const add = (run: RuntimeHookRun, message?: RuntimeMessage, toolCallId?: string) => {
    const turnId = message?.turnId ?? run.turnId;
    if (!turnId) return;
    anchors ??= createRuntimePluginUseAnchors(thread.messages);
    const uses = collected.get(turnId) ?? new Map<string, RuntimeHookUse>();
    uses.set(run.id, {
      run,
      anchor: anchors.forHook(toolCallId ? { ...run, toolCallId } : run, message),
    });
    collected.set(turnId, uses);
  };
  for (const run of thread.pendingHookRuns ?? []) add(run);
  for (const message of thread.messages) {
    // Standalone compaction records already own their Hook rows.
    if (message.contextCompaction) continue;
    for (const run of message.hookRuns ?? []) add(run, message);
    for (const tool of message.toolRuns ?? []) {
      for (const run of tool.hookRuns ?? []) add(run, message, tool.id);
    }
  }
  return new Map([...collected].map(([turnId, uses]) => {
    const next = [...uses.values()].sort((left, right) => (
      (left.run.startedAt ?? '').localeCompare(right.run.startedAt ?? '')
    ));
    const current = previous.get(turnId);
    // Streaming text must not invalidate every historical message's memoized props.
    return [turnId, current && sameHookUses(current, next) ? current : next];
  }));
}

function sameHookUses(left: RuntimeHookUse[], right: RuntimeHookUse[]): boolean {
  return left.length === right.length && left.every((use, index) => {
    const other = right[index];
    return use.run === other?.run
      && use.anchor?.messageId === other.anchor?.messageId
      && use.anchor?.toolRunId === other.anchor?.toolRunId
      && use.anchor?.placement === other.anchor?.placement;
  });
}
