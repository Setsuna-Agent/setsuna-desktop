import { cloneRuntimeThreadGoal, type RuntimeEvent, type RuntimeThreadGoal, type StoredThreadEvent } from '@setsuna-desktop/contracts';
import { isFeatureEventEnvelope, parseFeatureEvent } from '@setsuna-desktop/feature-core/events';
import { goalStateReplacedEvent } from '../contracts/index.js';

export function runtimeEvents(events: readonly StoredThreadEvent[]): RuntimeEvent[] {
  return events.filter((event): event is RuntimeEvent => event.type !== 'feature.event');
}

export function restoredTurnBelongsToGoal(
  allEvents: readonly StoredThreadEvent[],
  turnEvents: RuntimeEvent[],
  goal: RuntimeThreadGoal,
): boolean {
  const lifecycleEvent = [...turnEvents].reverse().find((event) => (
    event.type === 'message.created'
    && event.payload.message.goalMode
  ));
  let owner = lifecycleEvent?.type === 'message.created'
    ? lifecycleEvent.payload.message.goalMode?.goal
    : undefined;
  if (!owner) {
    const started = turnEvents.find((event) => event.type === 'turn.started');
    if (started?.type !== 'turn.started' || started.payload.taskKind !== 'goal') return false;
    const precedingState = [...allEvents].reverse().find((event) => (
      event.seq < started.seq && goalStateFromRecord(event).recognized
    ));
    owner = precedingState ? goalStateFromRecord(precedingState).goal ?? undefined : undefined;
  }
  if (!owner) return false;
  const ownerId = (owner as RuntimeThreadGoal & { id?: unknown }).id;
  const currentId = (goal as RuntimeThreadGoal & { id?: unknown }).id;
  // Snapshots written before Goal identities existed can only be matched by their objective.
  return typeof currentId === 'string' && currentId.trim()
    ? ownerId === currentId
    : owner.objective === goal.objective;
}

/** Includes legacy state events so replay and optimistic revision checks agree. */
export function goalStateFromRecord(record: StoredThreadEvent): Readonly<{
  recognized: boolean;
  goal: RuntimeThreadGoal | null;
}> {
  if (record.type === 'thread.goal_updated') {
    return { recognized: true, goal: cloneRuntimeThreadGoal(record.payload.goal) };
  }
  if (record.type === 'thread.goal_cleared') {
    return record.payload.cleared
      ? { recognized: true, goal: null }
      : { recognized: false, goal: null };
  }
  if (
    isFeatureEventEnvelope(record)
    && record.featureId === goalStateReplacedEvent.featureId
    && record.eventType === goalStateReplacedEvent.eventType
  ) {
    return { recognized: true, goal: parseFeatureEvent(goalStateReplacedEvent, record).goal };
  }
  return { recognized: false, goal: null };
}
