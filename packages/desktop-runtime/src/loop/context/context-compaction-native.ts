import type { ModelCompactionResult, RuntimeMessage } from '@setsuna-desktop/contracts';
import { estimateRuntimeMessageTokens, type RuntimeContextCompactionCandidate } from './context-compaction.js';
import { isTaskInput } from './runtime-skill-activation-context.js';

/** A standalone response owns its entire replacement window; V2 retains client-selected originals. */
export function nativeCompactionCandidate(
  candidate: RuntimeContextCompactionCandidate,
  messages: RuntimeMessage[],
  mode: Extract<ModelCompactionResult, { kind: 'native' }>['mode'],
  nativeTokens: number,
): RuntimeContextCompactionCandidate {
  const policies = new Set(messages.filter((message) => (message.role === 'system' || message.role === 'developer') && !message.contextCompaction).map((message) => message.id));
  const retained = new Set(mode === 'responses-v2' ? policies : []);
  if (mode === 'responses-v2') {
    let available = candidate.targetContextTokens - nativeTokens
      - estimateRuntimeMessageTokens(messages.filter((message) => policies.has(message.id)));
    // V2 summarizes the whole captured window. Replaying its old assistant/tool suffix would
    // duplicate that window; retain genuine user inputs, prioritizing the latest corrections.
    for (const message of [...messages].reverse()) {
      if (message.visibility === 'transcript' || !isTaskInput(message)) continue;
      const tokens = estimateRuntimeMessageTokens([message]);
      if (tokens > available) continue;
      retained.add(message.id);
      available -= tokens;
    }
  }
  const olderMessages = messages.filter((message) => message.visibility !== 'transcript' && !retained.has(message.id));
  return {
    ...candidate,
    olderMessages,
    historyTokens: estimateRuntimeMessageTokens(olderMessages),
    olderMessageIds: messages.map((message) => message.id),
    pinnedMessages: messages.filter((message) => retained.has(message.id)),
    recentMessages: [],
  };
}
