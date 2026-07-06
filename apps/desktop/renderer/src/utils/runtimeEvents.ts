import { applyRuntimeEventToThread, type RuntimeEvent, type RuntimeThread } from '@setsuna-desktop/contracts';
import type { ToolRuntimeEvent } from '../components/workspace/model.js';

export function applyRuntimeEvent(thread: RuntimeThread, event: RuntimeEvent): RuntimeThread {
  return applyRuntimeEventToThread(thread, event);
}

export function isActivityEvent(event: RuntimeEvent): boolean {
  return (
    isToolEvent(event) ||
    event.type === 'approval.requested' ||
    event.type === 'approval.resolved' ||
    event.type === 'runtime.error' ||
    event.type === 'thread.context_cleared' ||
    event.type === 'thread.context_compacted' ||
    event.type === 'thread.context_compacting' ||
    event.type === 'turn.started' ||
    event.type === 'turn.completed' ||
    event.type === 'turn.cancelled'
  );
}

function isToolEvent(event: RuntimeEvent): event is ToolRuntimeEvent {
  return event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'hook.started' || event.type === 'hook.completed';
}
