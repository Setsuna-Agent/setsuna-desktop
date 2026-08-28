import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  ApprovalReviewModelOption,
  ApprovalReviewSettingsState,
  ApprovalReviewSettingsUpdate,
} from './capabilities.js';
import { approvalReviewModelSelectionCodec } from './settings.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const approvalReviewSettingsStateCodec = defineRuntimeCodec<ApprovalReviewSettingsState>((value) => {
  const record = objectRecord(value, 'Approval review settings state must be an object.');
  if (!Array.isArray(record.availableModels)) {
    throw new Error('Approval review availableModels must be an array.');
  }
  return Object.freeze({
    selection: approvalReviewModelSelectionCodec.parse(record.selection),
    revision: nonNegativeInteger(record.revision, 'revision'),
    availableModels: Object.freeze(record.availableModels.map(modelOption)),
  });
});

const settingsUpdateCodec = defineRuntimeCodec<ApprovalReviewSettingsUpdate>((value) => {
  const record = objectRecord(value, 'Approval review settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expectedRevision'),
    selection: approvalReviewModelSelectionCodec.parse(record.selection),
  });
});

const settingsErrors = Object.freeze({
  SETTINGS_UNAVAILABLE: { status: 503 },
  REVISION_CONFLICT: { status: 409 },
});

export const readApprovalReviewSettings = defineFeatureOperation({
  id: 'approval-review.settings.read',
  method: 'GET',
  path: '/v1/features/approval-review/settings',
  input: emptyInputCodec,
  output: approvalReviewSettingsStateCodec,
  errors: settingsErrors,
  idempotency: 'safe',
});

export const updateApprovalReviewSettings = defineFeatureOperation({
  id: 'approval-review.settings.update',
  method: 'PATCH',
  path: '/v1/features/approval-review/settings',
  input: settingsUpdateCodec,
  output: approvalReviewSettingsStateCodec,
  errors: settingsErrors,
  idempotency: 'idempotent',
});

function modelOption(value: unknown): ApprovalReviewModelOption {
  const record = objectRecord(value, 'Approval review model option must be an object.');
  for (const key of ['providerId', 'providerName', 'modelId', 'modelName', 'modelCode'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) {
      throw new Error(`Approval review ${key} is invalid.`);
    }
  }
  return Object.freeze({
    providerId: record.providerId as string,
    providerName: record.providerName as string,
    modelId: record.modelId as string,
    modelName: record.modelName as string,
    modelCode: record.modelCode as string,
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Approval review ${label} is invalid.`);
  }
  return value as number;
}
