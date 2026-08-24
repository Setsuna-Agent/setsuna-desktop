import type { RuntimeCodec } from './codec.js';
import type { FeatureId } from './definition.js';
import type { Disposer } from './scope.js';

const DOCUMENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export type FeatureSettingsSyncPolicy = 'portable' | 'device-local' | 'never';

export type FeatureSecretMetadata = Readonly<{
  set: boolean;
  preview: string;
}>;

export type FeatureSettingsDocumentDefinition<
  TStored,
  TPublic,
  TPatch,
  TSecretPatch,
> = Readonly<{
  featureId: FeatureId;
  documentId: string;
  currentVersion: number;
  schema: RuntimeCodec<TStored>;
  defaults: () => TStored;
  migrations: Readonly<Record<number, (value: unknown) => unknown>>;
  publicProjection(
    value: TStored,
    secrets: Readonly<Record<string, FeatureSecretMetadata>>,
  ): TPublic;
  applyPatch(value: TStored, patch: TPatch): TStored;
  secretNames: readonly string[];
  credentialBackupSecretNames?: readonly string[];
  normalizeSecretPatch(patch: TSecretPatch): Readonly<Record<string, string | null>>;
  syncPolicy: FeatureSettingsSyncPolicy;
}>;

export type ErasedFeatureSettingsDocumentDefinition = Readonly<{
  featureId: FeatureId;
  documentId: string;
  currentVersion: number;
  schema: RuntimeCodec<unknown>;
  defaults(): unknown;
  migrations: Readonly<Record<number, (value: unknown) => unknown>>;
  publicProjection(
    value: unknown,
    secrets: Readonly<Record<string, FeatureSecretMetadata>>,
  ): unknown;
  applyPatch(value: unknown, patch: unknown): unknown;
  secretNames: readonly string[];
  credentialBackupSecretNames: readonly string[];
  normalizeSecretPatch(patch: unknown): Readonly<Record<string, string | null>>;
  syncPolicy: FeatureSettingsSyncPolicy;
}>;

export type FeatureSettingsBundle<
  TDocuments extends Readonly<Record<string, FeatureSettingsDocumentDefinition<any, any, any, any>>>,
> = Readonly<{
  featureId: FeatureId;
  documents: TDocuments;
  erasedDocuments: readonly ErasedFeatureSettingsDocumentDefinition[];
}>;

export type ErasedFeatureSettingsBundle = Readonly<{
  featureId: FeatureId;
  erasedDocuments: readonly ErasedFeatureSettingsDocumentDefinition[];
}>;

export interface RuntimeFeatureSettingsDocumentHandle<
  TStored,
  TPublic,
  TPatch,
  TSecretPatch,
> {
  exists(): Promise<boolean>;
  initialize(input: Readonly<{
    value: TStored;
    secrets?: Readonly<Record<string, string>>;
  }>): Promise<{ value: TPublic; revision: number }>;
  read(): Promise<{ value: TStored; revision: number }>;
  readPublic(): Promise<{ value: TPublic; revision: number }>;
  readSecret(name: string): Promise<string | undefined>;
  update(input: Readonly<{
    expectedRevision: number;
    patch: TPatch;
    secretPatch?: TSecretPatch;
  }>): Promise<{ value: TPublic; revision: number }>;
  subscribeRuntime(
    listener: (value: { value: TStored; revision: number }) => void,
  ): Disposer;
}

export interface RuntimeFeatureSettingsRegistry {
  /** Validates the complete static catalog before publishing any document. */
  registerBundles(bundles: readonly ErasedFeatureSettingsBundle[]): void;
  open<TStored, TPublic, TPatch, TSecretPatch>(
    definition: FeatureSettingsDocumentDefinition<TStored, TPublic, TPatch, TSecretPatch>,
  ): RuntimeFeatureSettingsDocumentHandle<TStored, TPublic, TPatch, TSecretPatch>;
  readPublicDocument(
    featureId: FeatureId,
    documentId: string,
  ): Promise<{ value: unknown; revision: number }>;
  updatePublicDocument(input: Readonly<{
    featureId: FeatureId;
    documentId: string;
    expectedRevision: number;
    patch: unknown;
    secretPatch?: unknown;
  }>): Promise<{ value: unknown; revision: number }>;
  diagnoseDocument(featureId: FeatureId, documentId: string): Promise<FeatureSettingsDiagnosis>;
  resetDocument(input: Readonly<{
    featureId: FeatureId;
    documentId: string;
    expectedDiagnosisId: string;
    confirmed: true;
  }>): Promise<{ revision: number }>;
  exportPortableDocuments(): Promise<readonly PortableFeatureSettingsDocument[]>;
  exportCredentialBackups(): Promise<readonly FeatureCredentialBackup[]>;
  importPortableDocuments(
    documents: readonly PortableFeatureSettingsDocument[],
  ): Promise<readonly Readonly<{
    featureId: FeatureId;
    documentId: string;
    revision: number;
  }>[]>;
}

export type FeatureSettingsDiagnosis = Readonly<{
  featureId: FeatureId;
  documentId: string;
  status:
    | 'ok'
    | 'missing'
    | 'schema-invalid'
    | 'migration-failed'
    | 'secret-reference-unavailable';
  diagnosisId: string;
  safeDetails?: Readonly<Record<string, string | number | boolean>>;
}>;

export type PortableFeatureSettingsDocument = Readonly<{
  featureId: FeatureId;
  documentId: string;
  schemaVersion: number;
  data: unknown;
}>;

/** Plaintext values cross only the authenticated runtime-to-main backup boundary. */
export type FeatureCredentialBackup = Readonly<{
  featureId: FeatureId;
  documentId: string;
  secretName: string;
  value: string;
}>;

export class FeatureSettingsRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT' as const;

  constructor(
    readonly currentRevision: number,
    readonly currentPublicValue: unknown,
  ) {
    super(`Feature settings revision changed to ${currentRevision}.`);
    this.name = 'FeatureSettingsRevisionConflictError';
  }
}

export class FeatureSettingsDocumentError extends Error {
  constructor(
    readonly status: Exclude<FeatureSettingsDiagnosis['status'], 'ok' | 'missing'>,
    message: string,
  ) {
    super(message);
    this.name = 'FeatureSettingsDocumentError';
  }
}

export function defineFeatureSettingsDocument<
  TStored,
  TPublic,
  TPatch,
  TSecretPatch,
>(input: Omit<
  FeatureSettingsDocumentDefinition<TStored, TPublic, TPatch, TSecretPatch>,
  'featureId' | 'documentId'
>): Omit<
  FeatureSettingsDocumentDefinition<TStored, TPublic, TPatch, TSecretPatch>,
  'featureId' | 'documentId'
> {
  if (!Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1) {
    throw new Error('Feature settings currentVersion must be a positive integer.');
  }
  for (let version = 1; version < input.currentVersion; version += 1) {
    if (typeof input.migrations[version] !== 'function') {
      throw new Error(`Feature settings migration ${version} -> ${version + 1} is missing.`);
    }
  }
  const secretNames = [...new Set(input.secretNames)];
  if (secretNames.length !== input.secretNames.length || secretNames.some((name) => !DOCUMENT_ID_PATTERN.test(name))) {
    throw new Error('Feature settings secret names must be unique lowercase kebab identifiers.');
  }
  const credentialBackupSecretNames = [...new Set(input.credentialBackupSecretNames ?? [])];
  if (
    credentialBackupSecretNames.length !== (input.credentialBackupSecretNames?.length ?? 0)
    || credentialBackupSecretNames.some((name) => !secretNames.includes(name))
  ) {
    throw new Error('Feature credential backup names must be unique declared secret names.');
  }
  return Object.freeze({
    ...input,
    migrations: Object.freeze({ ...input.migrations }),
    secretNames: Object.freeze(secretNames),
    credentialBackupSecretNames: Object.freeze(credentialBackupSecretNames),
  });
}

export function defineFeatureSettingsBundle<
  const TDocuments extends Readonly<Record<string, Omit<
    FeatureSettingsDocumentDefinition<any, any, any, any>,
    'featureId' | 'documentId'
  >>>,
>(input: Readonly<{
  featureId: FeatureId;
  documents: TDocuments;
}>): FeatureSettingsBundle<{
  readonly [TKey in keyof TDocuments]: TDocuments[TKey] & {
    readonly featureId: FeatureId;
    readonly documentId: TKey & string;
  };
}> {
  const documents = Object.fromEntries(Object.entries(input.documents).map(([documentId, definition]) => {
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      throw new Error(`Invalid Feature settings documentId "${documentId}".`);
    }
    return [documentId, Object.freeze({ ...definition, featureId: input.featureId, documentId })];
  })) as {
    readonly [TKey in keyof TDocuments]: TDocuments[TKey] & {
      readonly featureId: FeatureId;
      readonly documentId: TKey & string;
    };
  };
  const erasedDocuments = Object.freeze(Object.values(documents).map((definition) => eraseDefinition(definition)));
  return Object.freeze({
    featureId: input.featureId,
    documents: Object.freeze(documents),
    erasedDocuments,
  });
}

function eraseDefinition<TStored, TPublic, TPatch, TSecretPatch>(
  definition: FeatureSettingsDocumentDefinition<TStored, TPublic, TPatch, TSecretPatch>,
): ErasedFeatureSettingsDocumentDefinition {
  return Object.freeze({
    featureId: definition.featureId,
    documentId: definition.documentId,
    currentVersion: definition.currentVersion,
    schema: Object.freeze({ parse: (value: unknown) => definition.schema.parse(value) as unknown }),
    defaults: () => definition.defaults() as unknown,
    migrations: definition.migrations,
    publicProjection: (value, secrets) => definition.publicProjection(value as TStored, secrets) as unknown,
    applyPatch: (value, patch) => definition.applyPatch(value as TStored, patch as TPatch) as unknown,
    secretNames: definition.secretNames,
    credentialBackupSecretNames: definition.credentialBackupSecretNames ?? Object.freeze([]),
    normalizeSecretPatch: (patch) => definition.normalizeSecretPatch(patch as TSecretPatch),
    syncPolicy: definition.syncPolicy,
  });
}
