import type { FeatureId } from '@setsuna-desktop/feature-core/definition';
import type {
  ErasedFeatureSettingsBundle,
  ErasedFeatureSettingsDocumentDefinition,
  FeatureCredentialBackup,
  FeatureSecretMetadata,
  FeatureSettingsDiagnosis,
  FeatureSettingsDocumentDefinition,
  PortableFeatureSettingsDocument,
  PortableFeatureSettingsRestoreTarget,
  RuntimeFeatureSettingsDocumentHandle,
  RuntimeFeatureSettingsRegistry,
} from '@setsuna-desktop/feature-core/settings';
import {
  FeatureSettingsDocumentError,
  FeatureSettingsRevisionConflictError,
} from '@setsuna-desktop/feature-core/settings';
import {
  FeatureCompositionValidationError,
  type FeatureCompositionIssue,
} from '@setsuna-desktop/feature-core/status';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { withFileStateUpdate } from '../../adapters/store/file-state-coordinator.js';
import { renameWithRetry, writeJsonFile } from '../../adapters/store/json-file.js';
import { isNodeError } from '../../shared/node-errors.js';
import {
  VersionedFileSecretStore,
  type FeatureSecretNamespace,
  type VersionedSecretPort,
} from './versioned-file-secret-store.js';
import {
  migratePortableDocument,
  preparePortableSettingsRestore,
  webDavRestoreStagingDataDir,
} from './portable-feature-settings-restore.js';

type StoredFeatureSettingsDocument = {
  featureId: string;
  documentId: string;
  schemaVersion: number;
  revision: number;
  secretRevision?: string;
  data: unknown;
};

type ReadDocument = {
  data: unknown;
  envelope: StoredFeatureSettingsDocument | null;
  revision: number;
  secretValues: Readonly<Record<string, string>>;
};

export class FileFeatureSettingsRegistry implements RuntimeFeatureSettingsRegistry {
  private readonly definitions = new Map<string, ErasedFeatureSettingsDocumentDefinition>();
  private readonly listeners = new Map<string, Set<(value: { value: unknown; revision: number }) => void>>();
  private readonly secrets: VersionedSecretPort;

  constructor(
    private readonly dataDir: string,
    secretPort?: VersionedSecretPort,
  ) {
    this.secrets = secretPort ?? new VersionedFileSecretStore(dataDir);
  }

  registerBundles(bundles: readonly ErasedFeatureSettingsBundle[]): void {
    const staged = new Map<string, ErasedFeatureSettingsDocumentDefinition>();
    const issues: FeatureCompositionIssue[] = [];

    for (const bundle of bundles) {
      for (const definition of bundle.erasedDocuments) {
        if (definition.featureId !== bundle.featureId) {
          issues.push({
            code: 'INVALID_SETTINGS_DOCUMENT',
            message: `Feature settings bundle "${bundle.featureId}" contains a document owned by "${definition.featureId}".`,
            featureIds: [bundle.featureId, definition.featureId],
          });
          continue;
        }
        const key = documentKey(definition.featureId, definition.documentId);
        if (this.definitions.has(key) || staged.has(key)) {
          issues.push({
            code: 'DUPLICATE_SETTINGS_DOCUMENT',
            message: `Feature settings document is registered more than once: ${key}`,
            featureIds: [definition.featureId],
          });
          continue;
        }
        try {
          validateDefinition(definition);
          staged.set(key, definition);
        } catch (error) {
          issues.push({
            code: 'INVALID_SETTINGS_DOCUMENT',
            message: `Feature settings document ${key} is invalid: ${errorMessage(error)}`,
            featureIds: [definition.featureId],
          });
        }
      }
    }

    if (issues.length) throw new FeatureCompositionValidationError(issues);
    for (const [key, definition] of staged) this.definitions.set(key, definition);
  }

  listRegisteredDocuments(): readonly Readonly<{ featureId: FeatureId; documentId: string }>[] {
    return Object.freeze([...this.definitions.values()].map((definition) => Object.freeze({
      featureId: definition.featureId,
      documentId: definition.documentId,
    })));
  }

  open<TStored, TPublic, TPatch, TSecretPatch>(
    definition: FeatureSettingsDocumentDefinition<TStored, TPublic, TPatch, TSecretPatch>,
  ): RuntimeFeatureSettingsDocumentHandle<TStored, TPublic, TPatch, TSecretPatch> {
    const erased = this.registeredDefinition(definition.featureId, definition.documentId);
    return Object.freeze({
      exists: () => this.documentExists(erased),
      initialize: async (input: Readonly<{
        value: TStored;
        secrets?: Readonly<Record<string, string>>;
      }>) => this.initializeDocument(erased, input) as Promise<{ value: TPublic; revision: number }>,
      read: async () => this.readStored(erased) as Promise<{ value: TStored; revision: number }>,
      readPublic: async () => this.readPublic(erased) as Promise<{ value: TPublic; revision: number }>,
      readSecret: (name: string) => this.readSecret(erased, name),
      update: async (input: Readonly<{
        expectedRevision: number;
        patch: TPatch;
        secretPatch?: TSecretPatch;
      }>) => this.updateDocument(erased, input) as Promise<{ value: TPublic; revision: number }>,
      subscribeRuntime: (listener: (value: { value: TStored; revision: number }) => void) => (
        this.subscribe(erased, listener as (value: { value: unknown; revision: number }) => void)
      ),
    });
  }

  async readPublicDocument(
    featureId: FeatureId,
    documentId: string,
  ): Promise<{ value: unknown; revision: number }> {
    return this.readPublic(this.registeredDefinition(featureId, documentId));
  }

  async updatePublicDocument(input: Readonly<{
    featureId: FeatureId;
    documentId: string;
    expectedRevision: number;
    patch: unknown;
    secretPatch?: unknown;
  }>): Promise<{ value: unknown; revision: number }> {
    return this.updateDocument(
      this.registeredDefinition(input.featureId, input.documentId),
      input,
    );
  }

  async diagnoseDocument(featureId: FeatureId, documentId: string): Promise<FeatureSettingsDiagnosis> {
    const definition = this.registeredDefinition(featureId, documentId);
    return withFileStateUpdate(this.documentPath(definition), () => this.diagnoseLocked(definition));
  }

  async resetDocument(input: Readonly<{
    featureId: FeatureId;
    documentId: string;
    expectedDiagnosisId: string;
    confirmed: true;
  }>): Promise<{ revision: number }> {
    if (input.confirmed !== true) throw new Error('Feature settings reset requires explicit confirmation.');
    const definition = this.registeredDefinition(input.featureId, input.documentId);
    const filePath = this.documentPath(definition);
    const result = await withFileStateUpdate(filePath, async () => {
      const diagnosis = await this.diagnoseLocked(definition);
      if (diagnosis.diagnosisId !== input.expectedDiagnosisId) {
        throw new FeatureSettingsRevisionConflictError(0, undefined);
      }
      const previousRevision = await bestEffortRevision(filePath);
      if (await isRegularFile(filePath)) {
        const quarantineDirectory = path.join(
          this.dataDir,
          'features',
          definition.featureId,
          'quarantine',
        );
        await mkdir(quarantineDirectory, { recursive: true });
        await renameWithRetry(
          filePath,
          path.join(
            quarantineDirectory,
            `${definition.documentId}-${Date.now()}-${diagnosis.diagnosisId.slice(0, 12)}.json`,
          ),
        );
      }
      const data = definition.schema.parse(definition.defaults());
      const revision = Math.max(1, previousRevision + 1);
      await writeJsonFile(filePath, {
        featureId: definition.featureId,
        documentId: definition.documentId,
        schemaVersion: definition.currentVersion,
        revision,
        data,
      } satisfies StoredFeatureSettingsDocument);
      return { data, revision };
    });
    this.publish(definition, result.data, result.revision);
    return { revision: result.revision };
  }

  async exportPortableDocuments(): Promise<readonly PortableFeatureSettingsDocument[]> {
    const portable: PortableFeatureSettingsDocument[] = [];
    for (const definition of this.definitions.values()) {
      if (definition.syncPolicy !== 'portable') continue;
      try {
        const result = await this.readStored(definition);
        portable.push(Object.freeze({
          featureId: definition.featureId,
          documentId: definition.documentId,
          schemaVersion: definition.currentVersion,
          data: structuredClone(result.value),
        }));
      } catch {
        // Invalid documents remain local and diagnosable, but never enter a new backup.
      }
    }
    return Object.freeze(portable);
  }

  async exportCredentialBackups(): Promise<readonly FeatureCredentialBackup[]> {
    const credentials: FeatureCredentialBackup[] = [];
    for (const definition of this.definitions.values()) {
      if (!definition.credentialBackupSecretNames.length) continue;
      const current = await withFileStateUpdate(
        this.documentPath(definition),
        () => this.readLocked(definition),
      );
      for (const secretName of definition.credentialBackupSecretNames) {
        const value = current.secretValues[secretName];
        if (!value) continue;
        credentials.push(Object.freeze({
          featureId: definition.featureId,
          documentId: definition.documentId,
          secretName,
          value,
        }));
      }
    }
    return Object.freeze(credentials);
  }

  async importPortableDocuments(
    documents: readonly PortableFeatureSettingsDocument[],
  ): Promise<readonly Readonly<{
    featureId: FeatureId;
    documentId: string;
    revision: number;
  }>[]> {
    const seen = new Set<string>();
    const results: Array<Readonly<{
      featureId: FeatureId;
      documentId: string;
      revision: number;
    }>> = [];

    for (const document of documents) {
      const definition = this.registeredDefinition(document.featureId, document.documentId);
      const key = documentKey(document.featureId, document.documentId);
      if (seen.has(key)) throw new Error(`Portable Feature settings document is duplicated: ${key}`);
      seen.add(key);
      if (definition.syncPolicy !== 'portable') {
        throw new Error(`Feature settings document is not portable: ${key}`);
      }
      const data = migratePortableDocument(definition, document);
      const filePath = this.documentPath(definition);
      const result = await withFileStateUpdate(filePath, async () => {
        const metadata = await bestEffortEnvelopeMetadata(filePath, definition);
        const revision = Math.max(1, (metadata?.revision ?? 0) + 1);
        await writeJsonFile(filePath, {
          featureId: definition.featureId,
          documentId: definition.documentId,
          schemaVersion: definition.currentVersion,
          revision,
          ...(metadata?.secretRevision ? { secretRevision: metadata.secretRevision } : {}),
          data,
        } satisfies StoredFeatureSettingsDocument);
        return { revision };
      });
      this.publish(definition, data, result.revision);
      results.push(Object.freeze({
        featureId: definition.featureId,
        documentId: definition.documentId,
        revision: result.revision,
      }));
    }

    return Object.freeze(results);
  }

  /**
   * Validates the complete restore payload against the live Feature catalog and
   * writes ready-to-commit envelopes into the isolated WebDAV work directory.
   * The active settings store is never modified by this preparation step.
   */
  async stagePortableDocumentsRestore(input: Readonly<{
    documents: readonly PortableFeatureSettingsDocument[];
    credentials: readonly FeatureCredentialBackup[];
    stagingRoot: string;
  }>): Promise<readonly PortableFeatureSettingsRestoreTarget[]> {
    const prepared = preparePortableSettingsRestore({
      documents: input.documents,
      credentials: input.credentials,
      resolveDefinition: (featureId, documentId) => this.registeredDefinition(featureId, documentId),
    });
    const stagingDataDir = webDavRestoreStagingDataDir(this.dataDir, input.stagingRoot);
    const stagingSecrets = new VersionedFileSecretStore(stagingDataDir);
    const targets: PortableFeatureSettingsRestoreTarget[] = [];

    for (const item of prepared) {
      const hasCredentials = Object.keys(item.credentials).length > 0;
      const current = await this.readRestoreBase(item.definition, hasCredentials);
      const data = item.portableData === undefined
        ? current.data
        : item.portableData.value;
      let secretRevision = current.secretRevision;

      if (hasCredentials) {
        const secretValues = Object.freeze({
          ...current.secretValues,
          ...item.credentials,
        });
        secretRevision = await stagingSecrets.stage(this.namespace(item.definition), secretValues);
        await stagingSecrets.finalize(this.namespace(item.definition), secretRevision);
      }

      await writeJsonFile(
        path.join(
          stagingDataDir,
          'features',
          item.definition.featureId,
          'settings',
          `${item.definition.documentId}.json`,
        ),
        {
          featureId: item.definition.featureId,
          documentId: item.definition.documentId,
          schemaVersion: item.definition.currentVersion,
          revision: Math.max(1, current.revision + 1),
          ...(secretRevision ? { secretRevision } : {}),
          data,
        } satisfies StoredFeatureSettingsDocument,
        { mode: 0o600 },
      );
      targets.push(Object.freeze({
        featureId: item.definition.featureId,
        documentId: item.definition.documentId,
        includesSecrets: hasCredentials,
      }));
    }

    return Object.freeze(targets);
  }

  private async readRestoreBase(
    definition: ErasedFeatureSettingsDocumentDefinition,
    includeSecretValues: boolean,
  ): Promise<Readonly<{
    data: unknown;
    revision: number;
    secretRevision?: string;
    secretValues: Readonly<Record<string, string>>;
  }>> {
    const filePath = this.documentPath(definition);
    const metadata = await bestEffortEnvelopeMetadata(filePath, definition);
    let data = definition.schema.parse(definition.defaults());
    try {
      const serialized = await readFile(filePath, 'utf8');
      try {
        const envelope = parseEnvelope(JSON.parse(serialized) as unknown, definition);
        data = migratePortableDocument(definition, {
          featureId: definition.featureId,
          documentId: definition.documentId,
          schemaVersion: envelope.schemaVersion,
          data: envelope.data,
        });
      } catch {
        // A damaged local payload falls back to defaults, matching recovery
        // reset semantics. Valid revision and secret metadata remain intact.
      }
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
    }
    const secretValues = includeSecretValues && metadata?.secretRevision
      ? await this.secrets.read(this.namespace(definition), metadata.secretRevision)
      : Object.freeze({});
    return Object.freeze({
      data,
      revision: metadata?.revision ?? 0,
      ...(metadata?.secretRevision ? { secretRevision: metadata.secretRevision } : {}),
      secretValues,
    });
  }

  private registeredDefinition(
    featureId: FeatureId,
    documentId: string,
  ): ErasedFeatureSettingsDocumentDefinition {
    const definition = this.definitions.get(documentKey(featureId, documentId));
    if (!definition) throw new Error(`Feature settings document is not registered: ${featureId}/${documentId}`);
    return definition;
  }

  private documentPath(definition: ErasedFeatureSettingsDocumentDefinition): string {
    return path.join(
      this.dataDir,
      'features',
      definition.featureId,
      'settings',
      `${definition.documentId}.json`,
    );
  }

  private namespace(definition: ErasedFeatureSettingsDocumentDefinition): FeatureSecretNamespace {
    return { featureId: definition.featureId, documentId: definition.documentId };
  }

  private documentExists(definition: ErasedFeatureSettingsDocumentDefinition): Promise<boolean> {
    return isRegularFile(this.documentPath(definition));
  }

  private async initializeDocument(
    definition: ErasedFeatureSettingsDocumentDefinition,
    input: Readonly<{ value: unknown; secrets?: Readonly<Record<string, string>> }>,
  ): Promise<{ value: unknown; revision: number }> {
    const filePath = this.documentPath(definition);
    const result = await withFileStateUpdate(filePath, async () => {
      if (await isRegularFile(filePath)) {
        const current = await this.readLocked(definition);
        return { data: current.data, publicValue: publicValue(definition, current), revision: current.revision };
      }
      const data = definition.schema.parse(input.value);
      const secretValues = validatedSecretValues(definition, input.secrets ?? {});
      const secretRevision = Object.keys(secretValues).length
        ? await this.secrets.stage(this.namespace(definition), secretValues)
        : undefined;
      try {
        await writeJsonFile(filePath, {
          featureId: definition.featureId,
          documentId: definition.documentId,
          schemaVersion: definition.currentVersion,
          revision: 1,
          ...(secretRevision ? { secretRevision } : {}),
          data,
        } satisfies StoredFeatureSettingsDocument);
      } catch (error) {
        if (secretRevision) await this.secrets.discard(this.namespace(definition), secretRevision).catch(() => undefined);
        throw error;
      }
      if (secretRevision) {
        try {
          await this.secrets.finalize(this.namespace(definition), secretRevision);
        } catch {
          // The envelope is the durable commit point. Referenced staged secrets
          // remain readable and recovery retries the idempotent finalize.
        }
      }
      const current: ReadDocument = { data, envelope: null, revision: 1, secretValues };
      return { data, publicValue: publicValue(definition, current), revision: 1 };
    });
    this.publish(definition, result.data, result.revision);
    return { value: result.publicValue, revision: result.revision };
  }

  private async readStored(
    definition: ErasedFeatureSettingsDocumentDefinition,
  ): Promise<{ value: unknown; revision: number }> {
    const result = await withFileStateUpdate(
      this.documentPath(definition),
      () => this.readLocked(definition),
    );
    return { value: structuredClone(result.data), revision: result.revision };
  }

  private async readPublic(
    definition: ErasedFeatureSettingsDocumentDefinition,
  ): Promise<{ value: unknown; revision: number }> {
    const result = await withFileStateUpdate(
      this.documentPath(definition),
      () => this.readLocked(definition),
    );
    return { value: publicValue(definition, result), revision: result.revision };
  }

  private async readSecret(
    definition: ErasedFeatureSettingsDocumentDefinition,
    name: string,
  ): Promise<string | undefined> {
    if (!definition.secretNames.includes(name)) throw new Error(`Unknown Feature secret: ${name}`);
    const result = await withFileStateUpdate(
      this.documentPath(definition),
      () => this.readLocked(definition),
    );
    return result.secretValues[name];
  }

  private async updateDocument(
    definition: ErasedFeatureSettingsDocumentDefinition,
    input: Readonly<{ expectedRevision: number; patch: unknown; secretPatch?: unknown }>,
  ): Promise<{ value: unknown; revision: number }> {
    const filePath = this.documentPath(definition);
    const result = await withFileStateUpdate(filePath, async () => {
      const current = await this.readLocked(definition);
      if (input.expectedRevision !== current.revision) {
        throw new FeatureSettingsRevisionConflictError(
          current.revision,
          publicValue(definition, current),
        );
      }
      const data = definition.schema.parse(definition.applyPatch(current.data, input.patch));
      let secretValues = current.secretValues;
      let stagedRevision: string | undefined;
      if (input.secretPatch !== undefined) {
        const changes = definition.normalizeSecretPatch(input.secretPatch);
        secretValues = applySecretChanges(definition, current.secretValues, changes);
        if (Object.keys(changes).length) {
          stagedRevision = await this.secrets.stage(this.namespace(definition), secretValues);
        }
      }
      const secretRevision = stagedRevision ?? current.envelope?.secretRevision;
      const revision = current.revision + 1;
      try {
        await writeJsonFile(filePath, {
          featureId: definition.featureId,
          documentId: definition.documentId,
          schemaVersion: definition.currentVersion,
          revision,
          ...(secretRevision ? { secretRevision } : {}),
          data,
        } satisfies StoredFeatureSettingsDocument);
      } catch (error) {
        if (stagedRevision) await this.secrets.discard(this.namespace(definition), stagedRevision).catch(() => undefined);
        throw error;
      }

      if (stagedRevision) {
        try {
          await this.secrets.finalize(this.namespace(definition), stagedRevision);
          await this.secrets.collect(this.namespace(definition), new Set([stagedRevision]));
        } catch {
          // The committed envelope can read a staged immutable revision; startup recovery retries finalize.
        }
      }
      const next: ReadDocument = {
        data,
        envelope: null,
        revision,
        secretValues,
      };
      return { data, publicValue: publicValue(definition, next), revision };
    });
    this.publish(definition, result.data, result.revision);
    return { value: result.publicValue, revision: result.revision };
  }

  private async readLocked(definition: ErasedFeatureSettingsDocumentDefinition): Promise<ReadDocument> {
    const filePath = this.documentPath(definition);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {
          data: definition.schema.parse(definition.defaults()),
          envelope: null,
          revision: 0,
          secretValues: {},
        };
      }
      throw error;
    }

    let envelope: StoredFeatureSettingsDocument;
    try {
      envelope = parseEnvelope(JSON.parse(raw), definition);
    } catch (error) {
      throw new FeatureSettingsDocumentError('schema-invalid', safeDocumentError(error));
    }
    let data = envelope.data;
    let migrated = false;
    if (envelope.schemaVersion > definition.currentVersion) {
      throw new FeatureSettingsDocumentError(
        'schema-invalid',
        `Unsupported settings schema version ${envelope.schemaVersion}.`,
      );
    }
    try {
      for (let version = envelope.schemaVersion; version < definition.currentVersion; version += 1) {
        data = definition.migrations[version](data);
        migrated = true;
      }
    } catch (error) {
      throw new FeatureSettingsDocumentError('migration-failed', safeDocumentError(error));
    }
    try {
      data = definition.schema.parse(data);
    } catch (error) {
      throw new FeatureSettingsDocumentError('schema-invalid', safeDocumentError(error));
    }
    if (migrated) {
      envelope = {
        ...envelope,
        schemaVersion: definition.currentVersion,
        revision: envelope.revision + 1,
        data,
      };
      await writeJsonFile(filePath, envelope);
    }

    const namespace = this.namespace(definition);
    try {
      await this.secrets.recover(namespace, envelope.secretRevision);
      const secretValues = envelope.secretRevision
        ? await this.secrets.read(namespace, envelope.secretRevision)
        : {};
      if (envelope.secretRevision) {
        await this.secrets.collect(namespace, new Set([envelope.secretRevision])).catch(() => undefined);
      }
      return { data, envelope, revision: envelope.revision, secretValues };
    } catch (error) {
      throw new FeatureSettingsDocumentError('secret-reference-unavailable', safeDocumentError(error));
    }
  }

  private subscribe(
    definition: ErasedFeatureSettingsDocumentDefinition,
    listener: (value: { value: unknown; revision: number }) => void,
  ): () => void {
    const key = documentKey(definition.featureId, definition.documentId);
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }

  private publish(
    definition: ErasedFeatureSettingsDocumentDefinition,
    value: unknown,
    revision: number,
  ): void {
    const listeners = this.listeners.get(documentKey(definition.featureId, definition.documentId));
    if (!listeners) return;
    for (const listener of listeners) listener({ value: structuredClone(value), revision });
  }

  private async diagnoseLocked(
    definition: ErasedFeatureSettingsDocumentDefinition,
  ): Promise<FeatureSettingsDiagnosis> {
    const filePath = this.documentPath(definition);
    let raw = '';
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return diagnosis(definition, 'missing', 'missing');
      }
      throw error;
    }
    try {
      const result = await this.readLocked(definition);
      return diagnosis(definition, 'ok', diagnosisHash('ok', raw), {
        revision: result.revision,
        schemaVersion: definition.currentVersion,
      });
    } catch (error) {
      const status = error instanceof FeatureSettingsDocumentError
        ? error.status
        : 'schema-invalid';
      return diagnosis(definition, status, diagnosisHash(status, raw), {
        currentVersion: definition.currentVersion,
      });
    }
  }
}

function validateDefinition(definition: ErasedFeatureSettingsDocumentDefinition): void {
  definition.schema.parse(definition.defaults());
  const backupNames = new Set(definition.credentialBackupSecretNames);
  if (
    backupNames.size !== definition.credentialBackupSecretNames.length
    || definition.credentialBackupSecretNames.some((name) => !definition.secretNames.includes(name))
  ) {
    throw new Error('Feature credential backup names must be unique declared secret names.');
  }
  for (let version = 1; version < definition.currentVersion; version += 1) {
    if (typeof definition.migrations[version] !== 'function') {
      throw new Error(`Feature settings migration ${version} -> ${version + 1} is missing.`);
    }
  }
}

function parseEnvelope(
  value: unknown,
  definition: ErasedFeatureSettingsDocumentDefinition,
): StoredFeatureSettingsDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings envelope must be an object.');
  const record = value as Record<string, unknown>;
  if (record.featureId !== definition.featureId || record.documentId !== definition.documentId) {
    throw new Error('Settings envelope identity does not match its registered document.');
  }
  if (!Number.isSafeInteger(record.schemaVersion) || (record.schemaVersion as number) < 1) {
    throw new Error('Settings schemaVersion is invalid.');
  }
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new Error('Settings revision is invalid.');
  }
  if (record.secretRevision !== undefined && typeof record.secretRevision !== 'string') {
    throw new Error('Settings secretRevision is invalid.');
  }
  return {
    featureId: definition.featureId,
    documentId: definition.documentId,
    schemaVersion: record.schemaVersion as number,
    revision: record.revision as number,
    ...(typeof record.secretRevision === 'string' ? { secretRevision: record.secretRevision } : {}),
    data: record.data,
  };
}

function publicValue(
  definition: ErasedFeatureSettingsDocumentDefinition,
  document: Pick<ReadDocument, 'data' | 'secretValues'>,
): unknown {
  const metadata = Object.fromEntries(definition.secretNames.map((name) => {
    const value = document.secretValues[name] ?? '';
    return [name, Object.freeze({ set: Boolean(value), preview: maskSecret(value) } satisfies FeatureSecretMetadata)];
  }));
  return structuredClone(definition.publicProjection(document.data, metadata));
}

function validatedSecretValues(
  definition: ErasedFeatureSettingsDocumentDefinition,
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const allowed = new Set(definition.secretNames);
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.has(name)) throw new Error(`Unknown Feature secret: ${name}`);
    if (typeof value !== 'string') throw new Error(`Feature secret "${name}" must be a string.`);
    if (value) normalized[name] = value;
  }
  return Object.freeze(normalized);
}

function applySecretChanges(
  definition: ErasedFeatureSettingsDocumentDefinition,
  current: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string | null>>,
): Readonly<Record<string, string>> {
  const next = { ...current };
  const allowed = new Set(definition.secretNames);
  for (const [name, value] of Object.entries(changes)) {
    if (!allowed.has(name)) throw new Error(`Unknown Feature secret: ${name}`);
    if (value === null || value === '') delete next[name];
    else if (typeof value === 'string') next[name] = value;
    else throw new Error(`Feature secret "${name}" must be a string or null.`);
  }
  return Object.freeze(next);
}

function diagnosis(
  definition: ErasedFeatureSettingsDocumentDefinition,
  status: FeatureSettingsDiagnosis['status'],
  diagnosisId: string,
  safeDetails?: Readonly<Record<string, string | number | boolean>>,
): FeatureSettingsDiagnosis {
  return Object.freeze({
    featureId: definition.featureId,
    documentId: definition.documentId,
    status,
    diagnosisId,
    ...(safeDetails ? { safeDetails: Object.freeze({ ...safeDetails }) } : {}),
  });
}

function diagnosisHash(status: string, raw: string): string {
  return createHash('sha256').update(status).update('\0').update(raw).digest('hex');
}

function documentKey(featureId: FeatureId, documentId: string): string {
  return `${featureId}\0${documentId}`;
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

function safeDocumentError(error: unknown): string {
  if (error instanceof Error && /version|identity|revision|schema/iu.test(error.message)) {
    return error.message;
  }
  return 'Feature settings document could not be validated.';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function bestEffortRevision(filePath: string): Promise<number> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as { revision?: unknown };
    return Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
      ? value.revision as number
      : 0;
  } catch {
    return 0;
  }
}

async function bestEffortEnvelopeMetadata(
  filePath: string,
  definition: ErasedFeatureSettingsDocumentDefinition,
): Promise<{ revision: number; secretRevision?: string } | null> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      record.featureId !== definition.featureId
      || record.documentId !== definition.documentId
      || !Number.isSafeInteger(record.revision)
      || (record.revision as number) < 1
    ) return null;
    return {
      revision: record.revision as number,
      ...(typeof record.secretRevision === 'string' ? { secretRevision: record.secretRevision } : {}),
    };
  } catch {
    return null;
  }
}
