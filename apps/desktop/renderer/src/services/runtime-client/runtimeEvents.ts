import {
  applyRuntimeEventToThread,
  RUNTIME_ACTIVITY_EVENT_DISPOSITIONS,
  type RuntimeActivityEvent,
  type RuntimeEvent,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';

export function applyRuntimeEvent(thread: RuntimeThread, event: RuntimeEvent): RuntimeThread {
  return applyRuntimeEventToThread(thread, event);
}

export function isActivityEvent(event: RuntimeEvent): event is RuntimeActivityEvent {
  return RUNTIME_ACTIVITY_EVENT_DISPOSITIONS[event.type].action === 'include';
}
