import type { RuntimeHookRun, RuntimeMessage, RuntimeThreadTurnStepSnapshot } from '@setsuna-desktop/contracts';

export type RuntimePluginUseAnchor = {
  messageId: string;
  toolRunId?: string;
  placement: 'before' | 'after';
};

/** Resolve source records to transcript positions without adding data to persisted events. */
export function createRuntimePluginUseAnchors(messages: RuntimeMessage[]) {
  const messageIndexes = new Map(messages.map((message, index) => [message.id, index]));
  const positions = new Map<string, { before: number; after: number }>();
  const assistantsByTurn = new Map<string | undefined, RuntimeMessage[]>();
  let order = 0;
  for (const message of messages) {
    const before = order++;
    for (const run of message.toolRuns ?? []) positions.set(run.id, { before: order++, after: order++ });
    positions.set(message.id, { before, after: order++ });
    if (message.role === 'assistant' && message.visibility !== 'model') {
      const assistants = assistantsByTurn.get(message.turnId) ?? [];
      assistants.push(message);
      assistantsByTurn.set(message.turnId, assistants);
    }
  }
  const position = (anchor: RuntimePluginUseAnchor | undefined) => anchor
    ? positions.get(anchor.toolRunId ?? anchor.messageId)?.[anchor.placement] ?? Infinity
    : Infinity;
  const assistants = (turnId: string | undefined) => assistantsByTurn.get(turnId) ?? [];

  return {
    first(left: RuntimePluginUseAnchor | undefined, right: RuntimePluginUseAnchor | undefined) {
      return position(right) < position(left) ? right : left ?? right;
    },
    forStep(turnId: string, step: RuntimeThreadTurnStepSnapshot): RuntimePluginUseAnchor | undefined {
      // The assistant message is created BEFORE its sampling snapshot. Use the input
      // boundary, not the snapshot timestamp, to find the response that loads the Skill.
      const inputIds = step.snapshot.conversationMessageIds ?? step.snapshot.messageIds ?? [];
      const inputIndexes = inputIds.flatMap((id) => {
        const index = messageIndexes.get(id);
        return index === undefined ? [] : [index];
      });
      const candidates = assistants(turnId);
      const boundary = inputIndexes.length ? Math.max(...inputIndexes) : undefined;
      const message = boundary !== undefined
        ? candidates.find((candidate) => messageIndexes.get(candidate.id)! > boundary)
        : [...candidates].reverse().find((candidate) => candidate.createdAt <= step.createdAt) ?? candidates[0];
      return message ? { messageId: message.id, placement: 'before' } : undefined;
    },
    forHook(run: RuntimeHookRun, message?: RuntimeMessage): RuntimePluginUseAnchor | undefined {
      const candidates = assistants(message?.turnId ?? run.turnId);
      const startsTurn = ['SessionStart', 'UserPromptSubmit', 'SubagentStart'].includes(run.eventName);
      const preceding = [...candidates].reverse().find((candidate) => (
        !run.startedAt || candidate.createdAt <= run.startedAt
      ));
      let placement: RuntimePluginUseAnchor['placement'] =
        ['PostToolUse', 'PostCompact', 'Stop', 'SubagentStop'].includes(run.eventName) ? 'after' : 'before';
      let owner = message?.role === 'assistant' ? message : undefined;
      // A steered prompt can trigger the same lifecycle Hook later in a turn.
      // Anchor it after that input, instead of moving it above the first response.
      if (run.eventName === 'UserPromptSubmit' && message?.role === 'user') {
        const followingInput = candidates.find((candidate) => messageIndexes.get(candidate.id)! > messageIndexes.get(message.id)!);
        owner = followingInput ?? preceding ?? candidates[0];
        placement = !followingInput && preceding ? 'after' : 'before';
      }
      // Non-tool Hooks are stored on the turn's user message, including Stop Hooks
      // that run after the answer. That storage owner is not their display position.
      if (!owner) {
        owner = startsTurn ? candidates[0] : preceding ?? candidates[0];
        if (!startsTurn && preceding) placement = 'after';
      }
      if (!owner) return undefined;
      return {
        messageId: owner.id,
        ...(run.toolCallId ? { toolRunId: run.toolCallId } : {}),
        placement,
      };
    },
  };
}
