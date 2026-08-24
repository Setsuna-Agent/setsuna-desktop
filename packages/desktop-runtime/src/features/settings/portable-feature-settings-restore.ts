import type { FeatureId } from '@setsuna-desktop/feature-core/definition';
import type {
  ErasedFeatureSettingsDocumentDefinition,
  FeatureCredentialBackup,
  PortableFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import path from 'node:path';

export type PreparedPortableSettingsRestore = Readonly<{
  definition: ErasedFeatureSettingsDocumentDefinition;
  portableData?: Readonly<{ value: unknown }>;
  credentials: Readonly<Record<string, string>>;
}>;

export function preparePortableSettingsRestore(input: Readonly<{
  documents: readonly PortableFeatureSettingsDocument[];
  credentials: readonly FeatureCredentialBackup[];
  resolveDefinition(
    featureId: FeatureId,
    documentId: string,
  ): ErasedFeatureSettingsDocumentDefinition;
}>): readonly PreparedPortableSettingsRestore[] {
  const prepared = new Map<string, {
    definition: ErasedFeatureSettingsDocumentDefinition;
    portableData?: Readonly<{ value: unknown }>;
    credentials: Record<string, string>;
  }>();
  const documentKeys = new Set<string>();
  const credentialKeys = new Set<string>();

  for (const document of input.documents) {
    const definition = input.resolveDefinition(document.featureId, document.documentId);
    const key = documentKey(document.featureId, document.documentId);
    if (documentKeys.has(key)) {
      throw new Error(`Portable Feature settings document is duplicated: ${key}`);
    }
    documentKeys.add(key);
    if (definition.syncPolicy !== 'portable') {
      throw new Error(`Feature settings document is not portable: ${key}`);
    }
    prepared.set(key, {
      definition,
      portableData: Object.freeze({
        value: migratePortableDocument(definition, document),
      }),
      credentials: {},
    });
  }

  for (const credential of input.credentials) {
    const definition = input.resolveDefinition(credential.featureId, credential.documentId);
    const key = documentKey(credential.featureId, credential.documentId);
    const credentialKey = `${key}\0${credential.secretName}`;
    if (credentialKeys.has(credentialKey)) {
      throw new Error(`Feature credential backup is duplicated: ${credentialKey}`);
    }
    credentialKeys.add(credentialKey);
    if (!definition.credentialBackupSecretNames.includes(credential.secretName)) {
      throw new Error(`Feature credential is not portable: ${credentialKey}`);
    }
    if (typeof credential.value !== 'string' || !credential.value) {
      throw new Error(`Feature credential backup is invalid: ${credentialKey}`);
    }
    const item = prepared.get(key) ?? {
      definition,
      credentials: {},
    };
    item.credentials[credential.secretName] = credential.value;
    prepared.set(key, item);
  }

  return Object.freeze([...prepared.values()].map((item) => Object.freeze({
    definition: item.definition,
    ...(item.portableData === undefined ? {} : { portableData: item.portableData }),
    credentials: Object.freeze({ ...item.credentials }),
  })));
}

export function webDavRestoreStagingDataDir(dataDir: string, stagingRoot: string): string {
  const workRoot = path.resolve(path.dirname(dataDir), '.webdav-sync-work');
  const resolved = path.resolve(stagingRoot);
  const relative = path.relative(workRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Feature settings restore staging path is outside the WebDAV work directory.');
  }
  return path.join(resolved, 'runtime');
}

export function migratePortableDocument(
  definition: ErasedFeatureSettingsDocumentDefinition,
  document: PortableFeatureSettingsDocument,
): unknown {
  if (!Number.isSafeInteger(document.schemaVersion) || document.schemaVersion < 1) {
    throw new Error('Portable Feature settings schemaVersion is invalid.');
  }
  if (document.schemaVersion > definition.currentVersion) {
    throw new Error(`Unsupported portable settings schema version ${document.schemaVersion}.`);
  }
  let data = document.data;
  for (let version = document.schemaVersion; version < definition.currentVersion; version += 1) {
    data = definition.migrations[version](data);
  }
  return definition.schema.parse(data);
}

function documentKey(featureId: string, documentId: string): string {
  return `${featureId}\0${documentId}`;
}
