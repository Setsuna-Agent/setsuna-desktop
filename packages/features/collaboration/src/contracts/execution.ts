import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

/** A child thread is reusable; each dispatch has its own owner and delivery receipt. */
export type CollaborationExecution = Readonly<{
  taskId: string;
  turnId: string;
  /** Absent for legacy records and turns started directly outside the parent dispatcher. */
  parentTurnId?: string;
  status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  delivery: 'pending' | 'delivered' | 'dismissed';
  deliveredToTurnId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  resultPreview?: string;
}>;

export const collaborationExecutionCodec = defineRuntimeCodec<CollaborationExecution>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid collaboration execution.');
  const record = value as Record<string, unknown>;
  const string = (key: string): string => {
    if (typeof record[key] !== 'string' || !record[key]) throw new Error(`Invalid collaboration execution ${key}.`);
    return record[key] as string;
  };
  const status = string('status');
  const delivery = string('delivery');
  if (!['queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'interrupted'].includes(status)) {
    throw new Error('Invalid collaboration execution status.');
  }
  if (!['pending', 'delivered', 'dismissed'].includes(delivery)) throw new Error('Invalid collaboration delivery state.');
  return Object.freeze({
    taskId: string('taskId'), turnId: string('turnId'),
    ...(record.parentTurnId !== undefined ? { parentTurnId: string('parentTurnId') } : {}),
    status: status as CollaborationExecution['status'], delivery: delivery as CollaborationExecution['delivery'],
    createdAt: string('createdAt'), updatedAt: string('updatedAt'),
    ...(record.deliveredToTurnId !== undefined ? { deliveredToTurnId: string('deliveredToTurnId') } : {}),
    ...(record.error !== undefined ? { error: string('error') } : {}),
    ...(record.resultPreview !== undefined ? { resultPreview: string('resultPreview') } : {}),
  });
});
