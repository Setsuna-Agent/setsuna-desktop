import type { LegacyRuntimeGoalEvent } from '@setsuna-desktop/contracts';
import {
  isFeatureEventEnvelope,
  parseFeatureEvent,
  type SequencedThreadEventRecord,
} from '@setsuna-desktop/feature-core/events';
import { goalStateReplacedEvent } from '../contracts/index.js';

/**
 * Preserve the published SWE notification surface without putting Goal state
 * back into the Core event union or writing a second legacy record.
 */
export function goalFeatureEventToLegacySweEvent(
  record: SequencedThreadEventRecord,
): LegacyRuntimeGoalEvent | null {
  if (
    !isFeatureEventEnvelope(record)
    || record.featureId !== goalStateReplacedEvent.featureId
    || record.eventType !== goalStateReplacedEvent.eventType
  ) return null;

  const state = parseFeatureEvent(goalStateReplacedEvent, record);
  const metadata = {
    id: record.id,
    seq: record.seq,
    threadId: record.threadId,
    ...(record.turnId ? { turnId: record.turnId } : {}),
    createdAt: record.createdAt,
  };
  return state.goal
    ? Object.freeze({
        ...metadata,
        type: 'thread.goal_updated' as const,
        payload: Object.freeze({ goal: state.goal }),
      })
    : Object.freeze({
        ...metadata,
        type: 'thread.goal_cleared' as const,
        payload: Object.freeze({ cleared: true }),
      });
}
