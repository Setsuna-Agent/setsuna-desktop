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
  let order = 0;
  for (const message of messages) {
    const before = order++;
    for (const run of message.toolRuns ?? []) positions.set(run.id, { before: order++, after: order++ });
    positions.set(message.id, { before, after: order++ });
  }
  const position = (anchor: RuntimePluginUseAnchor | undefined) => anchor
    ? positions.get(anchor.toolRunId ?? anchor.messageId)?.[anchor.placement] ?? Infinity
    : Infinity;
  const assistants = (turnId: string | undefined) => messages.filter((message) => (
    message.turnId === turnId && message.role === 'assistant' && message.visibility !== 'model'
  ));

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
      // Non-tool Hooks are stored on the turn's user message, including Stop Hooks
      // that run after the answer. That storage owner is not their display position.
      const owner = message?.role === 'assistant' ? message : startsTurn ? candidates[0] : preceding ?? candidates[0];
      if (!owner) return undefined;
      return {
        messageId: owner.id,
        ...(run.toolCallId ? { toolRunId: run.toolCallId } : {}),
        placement: !startsTurn && ((message?.role !== 'assistant' && preceding)
          || ['PostToolUse', 'PostCompact', 'Stop', 'SubagentStop'].includes(run.eventName)) ? 'after' : 'before',
      };
    },
  };
}
