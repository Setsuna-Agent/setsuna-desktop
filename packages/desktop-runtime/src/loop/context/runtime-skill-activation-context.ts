import type { RuntimeMessage } from '@setsuna-desktop/contracts';

/** Route capabilities from task input, never from reports encoded as user-role context. */
export function currentTurnSkillActivationText(messages: RuntimeMessage[], turnId: string): string {
  const requests = messages.filter(isTaskInput);
  const currentInputs = requests.filter((message) => message.turnId === turnId);
  // Only legacy inputs lack a turn ID. A different turn's request must not activate this turn's plugins.
  const legacyInput = currentInputs.length ? undefined : [...requests].reverse().find((message) => !message.turnId);
  const inputs = currentInputs.length ? currentInputs : legacyInput ? [legacyInput] : [];
  // Attachment metadata cannot stand in for an explicit Plugin reference in the request.
  return inputs.map((message) => message.content.trim()).filter(Boolean).join('\n');
}

export function isTaskInput(message: RuntimeMessage): boolean {
  return message.role === 'user'
    && message.visibility !== 'model'
    && !message.contextCompaction && !message.goalMode && !message.reviewMode && !message.planMode
    // Assigned tasks are actionable; collaboration reports, mailboxes and inherited history are context.
    && (!message.promptSource || (message.promptSource === 'collaboration' && message.inputKind === 'subagent_task'));
}
