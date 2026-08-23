import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileFeatureSettingsRegistry } from '../../../src/features/settings/file-feature-settings-registry.js';
import {
  VersionedFileSecretStore,
  type FeatureSecretNamespace,
  type VersionedSecretPort,
} from '../../../src/features/settings/versioned-file-secret-store.js';

const definition = imageGenerationSettings.documents.connection;
const namespace: FeatureSecretNamespace = {
  featureId: definition.featureId,
  documentId: definition.documentId,
};

describe('FileFeatureSettingsRegistry', () => {
  let temporaryRoot = '';

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = '';
  });

  it('recovers the envelope-selected secret across all three crash windows', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setsuna-feature-settings-'));
    const secretStore = new VersionedFileSecretStore(temporaryRoot);
    const registry = registeredRegistry(temporaryRoot, secretStore);
    const handle = registry.open(definition);
    await handle.initialize({
      value: { baseUrl: 'https://old.example.test', model: 'old' },
      secrets: { 'api-key': 'old-secret' },
    });

    // Crash before the envelope commit: the orphan stage must never supersede
    // the immutable revision still selected by the old envelope.
    await secretStore.stage(namespace, { 'api-key': 'orphan-secret' });
    const beforeCommitRecovery = registeredRegistry(temporaryRoot, secretStore).open(definition);
    await expect(beforeCommitRecovery.readSecret('api-key')).resolves.toBe('old-secret');
    expect((await secretFiles(temporaryRoot)).some((name) => name.endsWith('.staged.json'))).toBe(false);

    // Crash after the envelope commit but before finalize: the referenced
    // staged revision is already readable and is finalized on the next read.
    const faultingStore = new FinalizeOnceFailurePort(secretStore);
    const updating = registeredRegistry(temporaryRoot, faultingStore).open(definition);
    faultingStore.failNextFinalize = true;
    const committed = await updating.update({
      expectedRevision: 1,
      patch: { model: 'new' },
      secretPatch: { apiKey: 'new-secret' },
    });
    expect(committed.revision).toBe(2);
    await expect(updating.readSecret('api-key')).resolves.toBe('new-secret');
    expect((await secretFiles(temporaryRoot)).some((name) => name.endsWith('.staged.json'))).toBe(false);

    // Crash after finalize: a fresh registry resolves exactly the committed
    // revision and delayed collection removes the superseded final revision.
    const afterFinalizeRecovery = registeredRegistry(temporaryRoot, secretStore).open(definition);
    await expect(afterFinalizeRecovery.readSecret('api-key')).resolves.toBe('new-secret');
    const finals = (await secretFiles(temporaryRoot)).filter((name) => (
      name.endsWith('.json') && !name.endsWith('.staged.json')
    ));
    expect(finals).toHaveLength(1);
  });

  it('keeps a corrupt document diagnosable and quarantines it before confirmed reset', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setsuna-feature-settings-'));
    const registry = registeredRegistry(temporaryRoot);
    const handle = registry.open(definition);
    await handle.initialize({
      value: { baseUrl: 'https://images.example.test', model: 'fixture' },
      secrets: { 'api-key': 'retained-secret' },
    });
    const documentPath = featureDocumentPath(temporaryRoot);
    await writeFile(documentPath, '{"featureId":"image-generation","broken":true}\n', 'utf8');

    const diagnosis = await registry.diagnoseDocument(definition.featureId, definition.documentId);
    expect(diagnosis.status).toBe('schema-invalid');
    await expect(handle.readPublic()).rejects.toMatchObject({ status: 'schema-invalid' });
    await expect(registry.resetDocument({
      featureId: definition.featureId,
      documentId: definition.documentId,
      expectedDiagnosisId: 'stale-diagnosis',
      confirmed: true,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });

    const reset = await registry.resetDocument({
      featureId: definition.featureId,
      documentId: definition.documentId,
      expectedDiagnosisId: diagnosis.diagnosisId,
      confirmed: true,
    });
    expect(reset.revision).toBe(1);
    await expect(handle.readPublic()).resolves.toEqual({
      value: { baseUrl: '', model: '', apiKeySet: false, apiKeyPreview: '' },
      revision: 1,
    });
    expect(await readdir(path.join(temporaryRoot, 'features', 'image-generation', 'quarantine')))
      .toHaveLength(1);
    // Recovery reset does not silently erase credential material. Explicit
    // credential clearing is a separate settings update.
    expect(await secretFiles(temporaryRoot)).not.toHaveLength(0);
  });

  it('imports portable data as a new local revision without exporting or replacing its secret reference', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setsuna-feature-settings-'));
    const registry = registeredRegistry(temporaryRoot);
    const handle = registry.open(definition);
    await handle.initialize({
      value: { baseUrl: 'https://local.example.test', model: 'local' },
      secrets: { 'api-key': 'device-secret' },
    });

    const exported = await registry.exportPortableDocuments();
    const credentialBackups = await registry.exportCredentialBackups();
    expect(exported).toEqual([{
      featureId: definition.featureId,
      documentId: definition.documentId,
      schemaVersion: 1,
      data: { baseUrl: 'https://local.example.test', model: 'local' },
    }]);
    expect(JSON.stringify(exported)).not.toContain('device-secret');
    expect(JSON.stringify(exported)).not.toContain('secretRevision');
    expect(credentialBackups).toEqual([{
      featureId: definition.featureId,
      documentId: definition.documentId,
      secretName: 'api-key',
      value: 'device-secret',
    }]);

    await registry.importPortableDocuments([{
      featureId: definition.featureId,
      documentId: definition.documentId,
      schemaVersion: 1,
      data: { baseUrl: 'https://remote.example.test', model: 'remote' },
    }]);
    await expect(handle.readPublic()).resolves.toEqual({
      value: {
        baseUrl: 'https://remote.example.test',
        model: 'remote',
        apiKeySet: true,
        apiKeyPreview: 'dev••••cret',
      },
      revision: 2,
    });
    await expect(handle.readSecret('api-key')).resolves.toBe('device-secret');
  });
});

function registeredRegistry(
  dataDir: string,
  secretPort?: VersionedSecretPort,
): FileFeatureSettingsRegistry {
  const registry = new FileFeatureSettingsRegistry(dataDir, secretPort);
  registry.register(imageGenerationSettings);
  return registry;
}

function featureDocumentPath(dataDir: string): string {
  return path.join(dataDir, 'features', 'image-generation', 'settings', 'connection.json');
}

async function secretFiles(dataDir: string): Promise<string[]> {
  return readdir(path.join(dataDir, 'secrets', 'image-generation', 'connection'));
}

class FinalizeOnceFailurePort implements VersionedSecretPort {
  failNextFinalize = false;

  constructor(private readonly delegate: VersionedSecretPort) {}

  stage(namespace: FeatureSecretNamespace, values: Readonly<Record<string, string>>): Promise<string> {
    return this.delegate.stage(namespace, values);
  }

  read(namespace: FeatureSecretNamespace, revision: string): Promise<Readonly<Record<string, string>>> {
    return this.delegate.read(namespace, revision);
  }

  async finalize(namespace: FeatureSecretNamespace, revision: string): Promise<void> {
    if (this.failNextFinalize) {
      this.failNextFinalize = false;
      throw new Error('simulated process interruption before secret finalize');
    }
    await this.delegate.finalize(namespace, revision);
  }

  discard(namespace: FeatureSecretNamespace, revision: string): Promise<void> {
    return this.delegate.discard(namespace, revision);
  }

  recover(namespace: FeatureSecretNamespace, referencedRevision?: string): Promise<void> {
    return this.delegate.recover(namespace, referencedRevision);
  }

  collect(namespace: FeatureSecretNamespace, retainedRevisions: ReadonlySet<string>): Promise<void> {
    return this.delegate.collect(namespace, retainedRevisions);
  }
}
