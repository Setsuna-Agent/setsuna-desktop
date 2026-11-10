import type { RuntimeApprovalRequest, StoredThreadEvent } from '@setsuna-desktop/contracts';
import { isActiveTask, type AssistantTask, type AssistantTaskRequest, type AssistantTaskStatus, type AssistantTurnOutcome } from '../contracts/index.js';

export function clip(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

/** Converts a Core approval into what an assistant can relay to a remote user. */
export function requestFromApproval(approval: RuntimeApprovalRequest): AssistantTaskRequest {
  if (approval.userInput) {
    const schema = approval.userInput.requestedSchema;
    return {
      id: approval.id, kind: 'input', toolName: approval.toolName,
      summary: clip([approval.userInput.title, approval.userInput.message].filter(Boolean).join('\n'), 1_500) || approval.toolName,
      fields: Object.entries(schema.properties).map(([id, field]) => ({
        id, label: clip(field.title ?? field.description ?? id, 200), required: schema.required?.includes(id) ?? false,
      })),
    };
  }
  // Permission grants and MCP elicitations carry structured answers that QQ text cannot express safely.
  const desktopOnly = Boolean(approval.elicitation || approval.permissionApprovalContext || approval.additionalPermissions);
  return {
    id: approval.id, kind: desktopOnly ? 'desktop' : 'approval', toolName: approval.toolName,
    summary: clip([approval.reason, approval.argumentsPreview].filter(Boolean).join('\n'), 1_500) || approval.toolName,
  };
}

export type TaskEventMatch =
  | { kind: 'input-started'; turnId: string }
  | { kind: 'request'; request: AssistantTaskRequest }
  | { kind: 'request-resolved'; requestId: string }
  | { kind: 'turn-ended' };

/** Relates a persisted Core event to one task; returns null for unrelated events. */
export function matchTaskEvent(task: AssistantTask, event: StoredThreadEvent): TaskEventMatch | null {
  if (event.threadId !== task.workThreadId) return null;
  switch (event.type) {
    case 'message.created': {
      const message = event.payload.message;
      return message.role === 'user' && task.clientId && message.clientId === task.clientId && message.turnId
        ? { kind: 'input-started', turnId: message.turnId } : null;
    }
    case 'approval.requested':
      return task.turnId && event.payload.approval.turnId === task.turnId
        ? { kind: 'request', request: requestFromApproval(event.payload.approval) } : null;
    case 'approval.resolved':
      return task.requests.some((request) => request.id === event.payload.approvalId)
        ? { kind: 'request-resolved', requestId: event.payload.approvalId } : null;
    case 'turn.completed':
    case 'turn.cancelled':
    case 'runtime.error':
      return task.turnId && event.turnId === task.turnId ? { kind: 'turn-ended' } : null;
    default:
      return null;
  }
}

export function taskStatusFromOutcome(outcome: AssistantTurnOutcome): AssistantTaskStatus | null {
  if (outcome.status === 'running') return null;
  return outcome.status === 'missing' ? 'interrupted' : outcome.status;
}

export type TaskReportReason = 'request' | 'started' | 'finished';

/**
 * Decides whether the assistant still owes the user an update. Only meaningful transitions wake the
 * assistant: new requests, a queued task actually starting, and terminal results.
 */
export function reportReason(task: AssistantTask): TaskReportReason | null {
  const reported = task.reported ?? { status: 'pending' as const, requestIds: [] };
  if (task.requests.some((request) => !reported.requestIds.includes(request.id))) return 'request';
  if (task.status === reported.status) return null;
  if (!isActiveTask(task)) return 'finished';
  if (task.status === 'running' && (reported.status === 'pending' || reported.status === 'queued')) return 'started';
  return null;
}

export function markReported(task: AssistantTask): void {
  task.reported = { status: task.status, requestIds: task.requests.map((request) => request.id) };
}

const STATUS_TEXT: Record<AssistantTaskStatus, string> = {
  pending: 'waiting for another task in the same workspace',
  queued: 'queued in its project conversation',
  running: 'started running',
  waiting: 'waiting for the user',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted before finishing',
};

/** Model-facing mailbox text; the assistant turns it into a short message in the user's language. */
export function formatTaskReport(tasks: readonly AssistantTask[], projectName: (projectId: string) => string): string {
  const sections = tasks.map((task) => {
    const lines = [`<task task_id="${task.id}" title="${escapeAttribute(task.title)}" project="${escapeAttribute(projectName(task.projectId))}" status="${task.status}">`];
    lines.push(`Status: ${STATUS_TEXT[task.status]}.`);
    for (const request of task.requests.filter((item) => !task.reported?.requestIds.includes(item.id))) {
      lines.push(request.kind === 'desktop'
        ? `Needs a decision that can only be made in Setsuna Desktop (request_id: ${request.id}, tool: ${request.toolName}):\n${request.summary}`
        : `Needs ${request.kind === 'input' ? 'information' : 'approval'} from the user (request_id: ${request.id}, tool: ${request.toolName}):\n${request.summary}`);
      if (request.fields?.length) lines.push(`Fields: ${request.fields.map((field) => `${field.id} (${field.label}${field.required ? ', required' : ''})`).join('; ')}`);
    }
    if (task.result) lines.push(`Result:\n${clip(task.result, 4_000)}`);
    if (task.error) lines.push(`Error: ${clip(task.error, 1_000)}`);
    lines.push('</task>');
    return lines.join('\n');
  });
  return [
    'Updates from project tasks you dispatched. Tell the user what matters in one concise message: results, failures, or what you need from them.',
    'Do not forward tool logs or invent progress. For a request, ask the user and then call assistant_answer_request with their answer.',
    ...sections,
  ].join('\n\n');
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/gu, (character) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character] ?? character);
}
