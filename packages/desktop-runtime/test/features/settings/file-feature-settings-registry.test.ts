import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { visionRecognitionSettings } from '@setsuna-desktop/feature-vision-recognition/contracts';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import { FeatureCompositionValidationError } from '@setsuna-desktop/feature-core/status';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

  it('publishes the static settings catalog atomically after validating every bundle', () => {
    const registry = new FileFeatureSettingsRegistry(path.join(os.tmpdir(), 'unused-feature-settings-fixture'));
    const foreignFeature = defineFeature('foreign-owner');

    expect(() => registry.registerBundles([
      imageGenerationSettings,
      Object.freeze({
        featureId: foreignFeature.id,
        erasedDocuments: imageGenerationSettings.erasedDocuments,
      }),
    ])).toThrow(FeatureCompositionValidationError);
    expect(registry.listRegisteredDocuments()).toEqual([]);

    expect(() => registry.registerBundles([
      imageGenerationSettings,
      imageGenerationSettings,
    ])).toThrow(FeatureCompositionValidationError);
    expect(registry.listRegisteredDocuments()).toEqual([]);

    registry.registerBundles([imageGenerationSettings]);
    expect(registry.listRegisteredDocuments()).toEqual([{
      featureId: 'image-generation',
      documentId: 'connection',
    }]);
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

  it('updates local settings without replacing their secret reference or exposing secret values', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setsuna-feature-settings-'));
    const registry = registeredRegistry(temporaryRoot);
    const handle = registry.open(definition);
    await handle.initialize({
      value: { baseUrl: 'https://local.example.test', model: 'local' },
      secrets: { 'api-key': 'device-secret' },
    });
    const before = JSON.parse(await readFile(featureDocumentPath(temporaryRoot), 'utf8'));

    await registry.updatePublicDocument({
      featureId: definition.featureId,
      documentId: definition.documentId,
      expectedRevision: 1,
      patch: { model: 'updated' },
    });
    const result = await registry.readPublicDocument(definition.featureId, definition.documentId);
    expect(result).toEqual({
      value: {
        baseUrl: 'https://local.example.test', model: 'updated',
        apiKeySet: true, apiKeyPreview: 'dev••••cret',
      },
      revision: 2,
    });
    expect(JSON.stringify(result)).not.toContain('device-secret');
    const after = JSON.parse(await readFile(featureDocumentPath(temporaryRoot), 'utf8'));
    expect(after.secretRevision).toBe(before.secretRevision);
    expect(JSON.stringify(after)).not.toContain('device-secret');
    await expect(handle.readSecret('api-key')).resolves.toBe('device-secret');
  });

  it('persists an explicit null selection through ordinary settings updates and restart', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setsuna-feature-settings-'));
    const registry = new FileFeatureSettingsRegistry(temporaryRoot);
    registry.registerBundles([visionRecognitionSettings]);
    const selection = visionRecognitionSettings.documents['model-selection'];
    const handle = registry.open(selection);
    await handle.initialize({ value: { providerId: 'local-provider', modelId: 'local-model' } });
    await handle.update({ expectedRevision: 1, patch: null });

    const restarted = new FileFeatureSettingsRegistry(temporaryRoot);
    restarted.registerBundles([visionRecognitionSettings]);
    await expect(restarted.open(selection).read()).resolves.toEqual({ value: null, revision: 2 });
  });

});

function registeredRegistry(
  dataDir: string,
  secretPort?: VersionedSecretPort,
): FileFeatureSettingsRegistry {
  const registry = new FileFeatureSettingsRegistry(dataDir, secretPort);
  registry.registerBundles([imageGenerationSettings]);
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
