import { createHash } from 'node:crypto';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ContextWindowSnapshot } from '../ports/thread-store.js';
import { runtimeMessageSemanticFingerprint } from './runtime-message-semantic-fingerprint.js';

/** A content version of the captured window: appends are allowed, edits/replacements are not. */
export function captureContextWindow(messages: readonly RuntimeMessage[], sourceIds?: ReadonlySet<string>): ContextWindowSnapshot {
  const selected = messages.filter((message) => message.visibility !== 'transcript' && (!sourceIds || sourceIds.has(message.id)));
  const hash = createHash('sha256');
  for (const message of selected) {
    hash.update(JSON.stringify([
      message.id, message.visibility, runtimeMessageSemanticFingerprint(message), message.providerMetadata,
      message.contextCompaction, message.promptSource, message.inputKind,
    ]));
  }
  return {
    messageIds: selected.map((message) => message.id), fingerprint: hash.digest('hex'),
    checkpointIds: messages.filter((message) => message.visibility !== 'transcript' && message.contextCompaction).map((message) => message.id),
  };
}

export function contextWindowMatches(messages: readonly RuntimeMessage[], expected: ContextWindowSnapshot): boolean {
  const current = captureContextWindow(messages, new Set(expected.messageIds));
  return current.fingerprint === expected.fingerprint && current.messageIds.length === expected.messageIds.length
    && JSON.stringify(current.checkpointIds) === JSON.stringify(expected.checkpointIds);
}
