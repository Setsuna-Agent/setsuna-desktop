import type {
  CoreRuntimeEvent,
  CoreRuntimeEventType,
  StoredThreadEvent,
} from '../events.js';

export type RuntimeEventProjectionDisposition =
  | { action: 'project' }
  | { action: 'ignore'; reason: string };

export type RuntimeEventActivityDisposition =
  | { action: 'include' }
  | { action: 'ignore'; reason: string };

const PROJECT = { action: 'project' } as const;
const INCLUDE = { action: 'include' } as const;

function ignore<const TReason extends string>(reason: TReason) {
  return { action: 'ignore', reason } as const;
}

const IGNORE_THREAD_DELETION = ignore(
  'The persisted snapshot is removed before the lifecycle event is published.',
);
const IGNORE_THREAD_REASONING_BOUNDARY = ignore(
  'Summary-part boundaries carry no snapshot data; reasoning items and deltas hold the content.',
);
const IGNORE_THREAD_WARNING = ignore(
  'Warnings remain in the append-only event and activity history without mutating thread state.',
);

export const RUNTIME_THREAD_EVENT_DISPOSITIONS = {
  'thread.created': PROJECT,
  'thread.updated': PROJECT,
  'thread.deleted': IGNORE_THREAD_DELETION,
  'thread.metadata_updated': PROJECT,
  'thread.memory_mode_updated': PROJECT,
  'thread.context_cleared': PROJECT,
  'thread.context_compacting': PROJECT,
  'thread.context_compacted': PROJECT,
  'turn.input_queued': PROJECT,
  'turn.input_updated': PROJECT,
  'turn.input_deleted': PROJECT,
  'turn.started': PROJECT,
  'turn.step_snapshot': PROJECT,
  'mailbox.delivered': PROJECT,
  'message.created': PROJECT,
  'message.delta': PROJECT,
  'message.updated': PROJECT,
  'message.plan_mode_updated': PROJECT,
  'message.completed': PROJECT,
  'item.started': PROJECT,
  'item.delta': PROJECT,
  'item.completed': PROJECT,
  'plan.delta': PROJECT,
  'reasoning.summary_delta': PROJECT,
  'reasoning.summary_part_added': IGNORE_THREAD_REASONING_BOUNDARY,
  'reasoning.raw_delta': PROJECT,
  'safety.buffering': PROJECT,
  'model.verification': PROJECT,
  'token.count': PROJECT,
  'turn.diff': PROJECT,
  'messages.deleted': PROJECT,
  'messages.truncated': PROJECT,
  'tool.preview': PROJECT,
  'tool.started': PROJECT,
  'tool.output_delta': PROJECT,
  'tool.completed': PROJECT,
  'hook.started': PROJECT,
  'hook.completed': PROJECT,
  'approval.requested': PROJECT,
  'approval.resolved': PROJECT,
  'turn.completed': PROJECT,
  'turn.cancelled': PROJECT,
  'runtime.warning': IGNORE_THREAD_WARNING,
  'runtime.error': PROJECT,
} as const satisfies Record<CoreRuntimeEventType, RuntimeEventProjectionDisposition>;

const IGNORE_SWE_THREAD_REFRESH = ignore(
  'The SWE protocol has no matching live notification; thread/read returns the current state.',
);
const IGNORE_SWE_QUEUE_STATE = ignore(
  'Queued input state is owned by the first-party runtime API and has no SWE notification.',
);
const IGNORE_SWE_HOOK_LIFECYCLE = ignore(
  'Hook lifecycle stays in runtime history; SWE clients observe its resulting item and turn events.',
);
const IGNORE_SWE_WARNING = ignore(
  'The SWE protocol has no runtime-warning notification; the warning remains in the event log.',
);

export const RUNTIME_SWE_EVENT_DISPOSITIONS = {
  'thread.created': PROJECT,
  'thread.updated': PROJECT,
  'thread.deleted': PROJECT,
  'thread.metadata_updated': IGNORE_SWE_THREAD_REFRESH,
  'thread.memory_mode_updated': IGNORE_SWE_THREAD_REFRESH,
  'thread.context_cleared': IGNORE_SWE_THREAD_REFRESH,
  'thread.context_compacting': PROJECT,
  'thread.context_compacted': PROJECT,
  'turn.input_queued': IGNORE_SWE_QUEUE_STATE,
  'turn.input_updated': IGNORE_SWE_QUEUE_STATE,
  'turn.input_deleted': IGNORE_SWE_QUEUE_STATE,
  'turn.started': PROJECT,
  'turn.step_snapshot': PROJECT,
  'mailbox.delivered': PROJECT,
  'message.created': PROJECT,
  'message.delta': PROJECT,
  'message.updated': IGNORE_SWE_THREAD_REFRESH,
  'message.plan_mode_updated': PROJECT,
  'message.completed': PROJECT,
  'item.started': PROJECT,
  'item.delta': PROJECT,
  'item.completed': PROJECT,
  'plan.delta': PROJECT,
  'reasoning.summary_delta': PROJECT,
  'reasoning.summary_part_added': PROJECT,
  'reasoning.raw_delta': PROJECT,
  'safety.buffering': PROJECT,
  'model.verification': PROJECT,
  'token.count': PROJECT,
  'turn.diff': PROJECT,
  'messages.deleted': IGNORE_SWE_THREAD_REFRESH,
  'messages.truncated': IGNORE_SWE_THREAD_REFRESH,
  'tool.preview': PROJECT,
  'tool.started': PROJECT,
  'tool.output_delta': PROJECT,
  'tool.completed': PROJECT,
  'hook.started': IGNORE_SWE_HOOK_LIFECYCLE,
  'hook.completed': IGNORE_SWE_HOOK_LIFECYCLE,
  'approval.requested': PROJECT,
  'approval.resolved': PROJECT,
  'turn.completed': PROJECT,
  'turn.cancelled': PROJECT,
  'runtime.warning': IGNORE_SWE_WARNING,
  'runtime.error': PROJECT,
} as const satisfies Record<CoreRuntimeEventType, RuntimeEventProjectionDisposition>;

const IGNORE_ACTIVITY_THREAD_STATE = ignore(
  'Thread state is rendered by its owning UI instead of being duplicated in the activity feed.',
);
const IGNORE_ACTIVITY_QUEUE_STATE = ignore(
  'Queued input state is rendered by composer controls instead of the activity feed.',
);
const IGNORE_ACTIVITY_CONVERSATION = ignore(
  'Conversation content is rendered in the transcript instead of being duplicated in activity.',
);
const IGNORE_ACTIVITY_STREAM_DETAIL = ignore(
  'Low-level stream detail stays in the conversation and debug projections.',
);
const IGNORE_ACTIVITY_MODEL_TELEMETRY = ignore(
  'Model telemetry stays in the turn and debug projections.',
);
const IGNORE_ACTIVITY_TOOL_DETAIL = ignore(
  'High-volume tool preparation and output are represented by started/completed activity.',
);

export const RUNTIME_ACTIVITY_EVENT_DISPOSITIONS = {
  'thread.created': IGNORE_ACTIVITY_THREAD_STATE,
  'thread.updated': IGNORE_ACTIVITY_THREAD_STATE,
  'thread.deleted': IGNORE_ACTIVITY_THREAD_STATE,
  'thread.metadata_updated': IGNORE_ACTIVITY_THREAD_STATE,
  'thread.memory_mode_updated': IGNORE_ACTIVITY_THREAD_STATE,
  'thread.context_cleared': INCLUDE,
  'thread.context_compacting': INCLUDE,
  'thread.context_compacted': INCLUDE,
  'turn.input_queued': IGNORE_ACTIVITY_QUEUE_STATE,
  'turn.input_updated': IGNORE_ACTIVITY_QUEUE_STATE,
  'turn.input_deleted': IGNORE_ACTIVITY_QUEUE_STATE,
  'turn.started': INCLUDE,
  'turn.step_snapshot': IGNORE_ACTIVITY_MODEL_TELEMETRY,
  'mailbox.delivered': IGNORE_ACTIVITY_CONVERSATION,
  'message.created': IGNORE_ACTIVITY_CONVERSATION,
  'message.delta': IGNORE_ACTIVITY_STREAM_DETAIL,
  'message.updated': IGNORE_ACTIVITY_CONVERSATION,
  'message.plan_mode_updated': IGNORE_ACTIVITY_CONVERSATION,
  'message.completed': IGNORE_ACTIVITY_CONVERSATION,
  'item.started': IGNORE_ACTIVITY_STREAM_DETAIL,
  'item.delta': IGNORE_ACTIVITY_STREAM_DETAIL,
  'item.completed': IGNORE_ACTIVITY_STREAM_DETAIL,
  'plan.delta': IGNORE_ACTIVITY_STREAM_DETAIL,
  'reasoning.summary_delta': IGNORE_ACTIVITY_STREAM_DETAIL,
  'reasoning.summary_part_added': IGNORE_ACTIVITY_STREAM_DETAIL,
  'reasoning.raw_delta': IGNORE_ACTIVITY_STREAM_DETAIL,
  'safety.buffering': IGNORE_ACTIVITY_MODEL_TELEMETRY,
  'model.verification': IGNORE_ACTIVITY_MODEL_TELEMETRY,
  'token.count': IGNORE_ACTIVITY_MODEL_TELEMETRY,
  'turn.diff': IGNORE_ACTIVITY_CONVERSATION,
  'messages.deleted': IGNORE_ACTIVITY_CONVERSATION,
  'messages.truncated': IGNORE_ACTIVITY_CONVERSATION,
  'tool.preview': IGNORE_ACTIVITY_TOOL_DETAIL,
  'tool.started': INCLUDE,
  'tool.output_delta': IGNORE_ACTIVITY_TOOL_DETAIL,
  'tool.completed': INCLUDE,
  'hook.started': INCLUDE,
  'hook.completed': INCLUDE,
  'approval.requested': INCLUDE,
  'approval.resolved': INCLUDE,
  'turn.completed': INCLUDE,
  'turn.cancelled': INCLUDE,
  'runtime.warning': INCLUDE,
  'runtime.error': INCLUDE,
} as const satisfies Record<CoreRuntimeEventType, RuntimeEventActivityDisposition>;

type EventTypesWithAction<
  TDispositions extends Record<CoreRuntimeEventType, { action: string }>,
  TAction extends string,
> = {
  [TType in CoreRuntimeEventType]: TDispositions[TType]['action'] extends TAction
    ? TType
    : never;
}[CoreRuntimeEventType];

export type RuntimeThreadProjectionIgnoredEvent = Extract<
  CoreRuntimeEvent,
  { type: EventTypesWithAction<typeof RUNTIME_THREAD_EVENT_DISPOSITIONS, 'ignore'> }
>;

export type RuntimeSweProjectionIgnoredEvent = Extract<
  CoreRuntimeEvent,
  { type: EventTypesWithAction<typeof RUNTIME_SWE_EVENT_DISPOSITIONS, 'ignore'> }
>;

export type RuntimeActivityEvent = Extract<
  CoreRuntimeEvent,
  { type: EventTypesWithAction<typeof RUNTIME_ACTIVITY_EVENT_DISPOSITIONS, 'include'> }
>;

export function isRuntimeThreadProjectionIgnoredEvent(
  event: CoreRuntimeEvent,
): event is RuntimeThreadProjectionIgnoredEvent {
  return RUNTIME_THREAD_EVENT_DISPOSITIONS[event.type].action === 'ignore';
}

/** Classify an opaque stored record without naming any Feature-owned event. */
export function isCoreRuntimeEvent(event: StoredThreadEvent): event is CoreRuntimeEvent {
  return Object.hasOwn(RUNTIME_THREAD_EVENT_DISPOSITIONS, event.type);
}

export function isRuntimeSweProjectionIgnoredEvent(
  event: CoreRuntimeEvent,
): event is RuntimeSweProjectionIgnoredEvent {
  return RUNTIME_SWE_EVENT_DISPOSITIONS[event.type].action === 'ignore';
}

export function isRuntimeActivityEvent(
  event: CoreRuntimeEvent,
): event is RuntimeActivityEvent {
  return RUNTIME_ACTIVITY_EVENT_DISPOSITIONS[event.type].action === 'include';
}
