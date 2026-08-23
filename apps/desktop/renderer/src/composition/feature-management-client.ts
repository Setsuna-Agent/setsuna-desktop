import type {
  DesktopRuntimeBridge,
  RuntimeFeatureOperationResponse,
  RuntimeRequestInput,
} from '@setsuna-desktop/contracts';
import { defineFeatureDefinition, type FeatureId } from '@setsuna-desktop/feature-core/definition';
import type { FeatureSettingsDiagnosis } from '@setsuna-desktop/feature-core/settings';
import type { FeatureStatusSnapshot } from '@setsuna-desktop/feature-core/status';

export type RegisteredFeatureSettingsDocument = Readonly<{
  featureId: FeatureId;
  documentId: string;
}>;

export type FeatureManagementSnapshot = Readonly<{
  features: readonly FeatureStatusSnapshot[];
  settings: readonly RegisteredFeatureSettingsDocument[];
}>;

export interface FeatureManagementClient {
  getStatus(options?: Readonly<{ signal?: AbortSignal }>): Promise<FeatureManagementSnapshot>;
  diagnoseDocument(
    featureId: FeatureId,
    documentId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<FeatureSettingsDiagnosis>;
  readPublicDocument(
    featureId: FeatureId,
    documentId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<Readonly<{ value: unknown; revision: number }>>;
  updatePublicDocument(input: Readonly<{
    featureId: FeatureId;
    documentId: string;
    expectedRevision: number;
    patch: unknown;
    secretPatch?: unknown;
    signal?: AbortSignal;
  }>): Promise<Readonly<{ value: unknown; revision: number }>>;
  resetDocument(input: Readonly<{
    featureId: FeatureId;
    documentId: string;
    expectedDiagnosisId: string;
    confirmed: true;
    signal?: AbortSignal;
  }>): Promise<Readonly<{ revision: number }>>;
}

export class FeatureManagementClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'FeatureManagementClientError';
  }
}

export function createFeatureManagementClient(bridge: DesktopRuntimeBridge): FeatureManagementClient {
  const client: FeatureManagementClient = {
    getStatus: (options = {}) => call(
      bridge,
      { path: '/v1/feature-management/status' },
      parseManagementSnapshot,
      options.signal,
    ),
    diagnoseDocument: (featureId, documentId, options = {}) => call(
      bridge,
      { path: `${documentPath(featureId, documentId)}/diagnosis` },
      (value) => parseDiagnosis(value, featureId, documentId),
      options.signal,
    ),
    readPublicDocument: (featureId, documentId, options = {}) => call(
      bridge,
      { path: documentPath(featureId, documentId) },
      parsePublicDocument,
      options.signal,
    ),
    updatePublicDocument: (input) => call(
      bridge,
      {
        path: documentPath(input.featureId, input.documentId),
        method: 'PATCH',
        body: {
          expectedRevision: input.expectedRevision,
          patch: input.patch,
          ...(input.secretPatch === undefined ? {} : { secretPatch: input.secretPatch }),
        },
      },
      parsePublicDocument,
      input.signal,
    ),
    resetDocument: (input) => call(
      bridge,
      {
        path: `${documentPath(input.featureId, input.documentId)}/reset`,
        method: 'POST',
        body: {
          expectedDiagnosisId: input.expectedDiagnosisId,
          confirmed: input.confirmed,
        },
      },
      parseResetResult,
      input.signal,
    ),
  };
  return Object.freeze(client);
}

async function call<T>(
  bridge: DesktopRuntimeBridge,
  input: RuntimeRequestInput,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw cancelledError();
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void bridge.cancelRequest(requestId);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await bridge.request<RuntimeFeatureOperationResponse>({
      ...input,
      requestId,
      responseMode: 'feature-operation',
    });
    if (signal?.aborted) throw cancelledError();
    if (!response.ok) {
      throw new FeatureManagementClientError(
        response.error.code,
        response.error.message,
        response.error.retryable,
      );
    }
    return parse(response.value);
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

function parseManagementSnapshot(value: unknown): FeatureManagementSnapshot {
  const record = objectRecord(value, 'Feature management status must be an object.');
  if (!Array.isArray(record.features) || !Array.isArray(record.settings)) {
    throw new Error('Feature management status arrays are missing.');
  }
  return Object.freeze({
    features: Object.freeze(record.features.map(parseFeatureStatus)),
    settings: Object.freeze(record.settings.map(parseRegisteredDocument)),
  });
}

function parseFeatureStatus(value: unknown): FeatureStatusSnapshot {
  const record = objectRecord(value, 'Feature status must be an object.');
  const definition = defineFeatureDefinition({
    id: requiredString(record.featureId, 'Feature status featureId is invalid.'),
    version: requiredString(record.version, 'Feature status version is invalid.'),
  });
  const criticality = oneOf(record.criticality, ['required', 'optional'] as const, 'Feature criticality is invalid.');
  const status = oneOf(record.status, ['active', 'degraded', 'failed', 'blocked'] as const, 'Feature status is invalid.');
  const lifecycle = oneOf(
    record.lifecycle,
    ['declared', 'starting', 'active', 'degraded', 'draining', 'stopped'] as const,
    'Feature lifecycle is invalid.',
  );
  const diagnostic = record.diagnostic === undefined
    ? undefined
    : (() => {
        const item = objectRecord(record.diagnostic, 'Feature diagnostic must be an object.');
        return Object.freeze({
          code: requiredString(item.code, 'Feature diagnostic code is invalid.'),
          message: requiredString(item.message, 'Feature diagnostic message is invalid.'),
        });
      })();
  return Object.freeze({
    featureId: definition.id,
    version: definition.version,
    criticality,
    status,
    lifecycle,
    ...(diagnostic ? { diagnostic } : {}),
  });
}

function parseRegisteredDocument(value: unknown): RegisteredFeatureSettingsDocument {
  const record = objectRecord(value, 'Registered Feature settings document must be an object.');
  const featureId = requiredString(record.featureId, 'Registered Feature settings featureId is invalid.');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(featureId)) throw new Error('Registered FeatureId is invalid.');
  const documentId = requiredString(record.documentId, 'Registered Feature settings documentId is invalid.');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(documentId)) throw new Error('Registered documentId is invalid.');
  return Object.freeze({ featureId: featureId as FeatureId, documentId });
}

function parseDiagnosis(value: unknown, featureId: FeatureId, documentId: string): FeatureSettingsDiagnosis {
  const record = objectRecord(value, 'Feature settings diagnosis must be an object.');
  if (record.featureId !== featureId || record.documentId !== documentId) {
    throw new Error('Feature settings diagnosis identity does not match the request.');
  }
  const status = oneOf(
    record.status,
    ['ok', 'missing', 'schema-invalid', 'migration-failed', 'secret-reference-unavailable'] as const,
    'Feature settings diagnosis status is invalid.',
  );
  const diagnosisId = requiredString(record.diagnosisId, 'Feature settings diagnosisId is invalid.');
  const safeDetails = record.safeDetails === undefined ? undefined : safeDetailRecord(record.safeDetails);
  return Object.freeze({
    featureId,
    documentId,
    status,
    diagnosisId,
    ...(safeDetails ? { safeDetails } : {}),
  });
}

function parsePublicDocument(value: unknown): Readonly<{ value: unknown; revision: number }> {
  const record = objectRecord(value, 'Feature settings document must be an object.');
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0 || !('value' in record)) {
    throw new Error('Feature settings document revision is invalid.');
  }
  return Object.freeze({ value: record.value, revision: record.revision as number });
}

function parseResetResult(value: unknown): Readonly<{ revision: number }> {
  const record = objectRecord(value, 'Feature settings reset result must be an object.');
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0) {
    throw new Error('Feature settings reset revision is invalid.');
  }
  return Object.freeze({ revision: record.revision as number });
}

function safeDetailRecord(value: unknown): Readonly<Record<string, string | number | boolean>> {
  const record = objectRecord(value, 'Feature settings diagnosis details must be an object.');
  const details: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      throw new Error('Feature settings diagnosis detail is invalid.');
    }
    details[key] = item;
  }
  return Object.freeze(details);
}

function documentPath(featureId: FeatureId, documentId: string): string {
  return `/v1/feature-management/${encodeURIComponent(featureId)}/settings/${encodeURIComponent(documentId)}`;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value;
}

function oneOf<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
  message: string,
): TValues[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(message);
  return value as TValues[number];
}

function cancelledError(): FeatureManagementClientError {
  return new FeatureManagementClientError('OPERATION_CANCELLED', 'Feature management request was cancelled.', false);
}
