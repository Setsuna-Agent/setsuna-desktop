import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export type CollaborationTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type CollaborationAgentIdentity = Readonly<{
  avatarSeed: string;
  displayName: string;
}>;

export type CollaborationTask = Readonly<{
  activeTurnId?: string;
  childThreadId: string;
  completedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  identity: CollaborationAgentIdentity;
  objective: string;
  resultPreview?: string;
  status: CollaborationTaskStatus;
  title: string;
  updatedAt: string;
}>;

export type CollaborationState = Readonly<{
  tasks: readonly CollaborationTask[];
}>;

export type CollaborationStateSnapshot = Readonly<{
  state: CollaborationState;
  throughSeq: number;
}>;

const TASK_STATUSES = new Set<CollaborationTaskStatus>([
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export const collaborationAgentIdentityCodec = defineRuntimeCodec<CollaborationAgentIdentity>((value) => {
  const record = objectRecord(value, 'Collaboration agent identity must be an object.');
  return Object.freeze({
    avatarSeed: requiredString(record.avatarSeed, 'Collaboration avatarSeed'),
    displayName: requiredString(record.displayName, 'Collaboration displayName'),
  });
});

export const collaborationTaskCodec = defineRuntimeCodec<CollaborationTask>((value) => {
  const record = objectRecord(value, 'Collaboration task must be an object.');
  if (typeof record.status !== 'string' || !TASK_STATUSES.has(record.status as CollaborationTaskStatus)) {
    throw new Error('Collaboration task status is invalid.');
  }
  return Object.freeze({
    id: requiredString(record.id, 'Collaboration task id'),
    childThreadId: requiredString(record.childThreadId, 'Collaboration childThreadId'),
    title: stringValue(record.title, 'Collaboration title'),
    objective: stringValue(record.objective, 'Collaboration objective'),
    identity: collaborationAgentIdentityCodec.parse(record.identity),
    status: record.status as CollaborationTaskStatus,
    ...(optionalString(record.activeTurnId, 'Collaboration activeTurnId') ? { activeTurnId: record.activeTurnId as string } : {}),
    ...(optionalString(record.resultPreview, 'Collaboration resultPreview') ? { resultPreview: record.resultPreview as string } : {}),
    ...(optionalString(record.error, 'Collaboration error') ? { error: record.error as string } : {}),
    createdAt: requiredString(record.createdAt, 'Collaboration createdAt'),
    updatedAt: requiredString(record.updatedAt, 'Collaboration updatedAt'),
    ...(optionalString(record.completedAt, 'Collaboration completedAt') ? { completedAt: record.completedAt as string } : {}),
  });
});

export const collaborationStateCodec = defineRuntimeCodec<CollaborationState>((value) => {
  const record = objectRecord(value, 'Collaboration state must be an object.');
  if (!Array.isArray(record.tasks)) throw new Error('Collaboration tasks must be an array.');
  return Object.freeze({ tasks: Object.freeze(record.tasks.map((task) => collaborationTaskCodec.parse(task))) });
});

export const collaborationStateSnapshotCodec = defineRuntimeCodec<CollaborationStateSnapshot>((value) => {
  const record = objectRecord(value, 'Collaboration state snapshot must be an object.');
  return Object.freeze({
    state: collaborationStateCodec.parse(record.state),
    throughSeq: nonNegativeInteger(record.throughSeq, 'Collaboration snapshot throughSeq'),
  });
});

export function createInitialCollaborationState(): CollaborationState {
  return Object.freeze({ tasks: Object.freeze([]) });
}

export function cloneCollaborationState(state: CollaborationState): CollaborationState {
  return collaborationStateCodec.parse(state);
}

export function isTerminalCollaborationTaskStatus(status: CollaborationTaskStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  const normalized = stringValue(value, label);
  if (!normalized) throw new Error(`${label} is invalid.`);
  return normalized;
}

function optionalString(value: unknown, label: string): value is string {
  if (value === undefined) return false;
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  return true;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
