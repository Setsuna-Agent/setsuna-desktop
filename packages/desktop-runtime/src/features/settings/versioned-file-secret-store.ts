import { randomUUID } from 'node:crypto';
import { chmod, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isNodeError } from '../../shared/node-errors.js';
import { renameWithRetry, writeJsonFile } from '../../adapters/store/json-file.js';

const SAFE_SEGMENT_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const REVISION_PATTERN = /^secret-[0-9a-f-]{36}$/u;

export type FeatureSecretNamespace = Readonly<{
  featureId: string;
  documentId: string;
}>;

export interface VersionedSecretPort {
  stage(
    namespace: FeatureSecretNamespace,
    values: Readonly<Record<string, string>>,
  ): Promise<string>;
  read(namespace: FeatureSecretNamespace, revision: string): Promise<Readonly<Record<string, string>>>;
  finalize(namespace: FeatureSecretNamespace, revision: string): Promise<void>;
  discard(namespace: FeatureSecretNamespace, revision: string): Promise<void>;
  recover(namespace: FeatureSecretNamespace, referencedRevision?: string): Promise<void>;
  collect(namespace: FeatureSecretNamespace, retainedRevisions: ReadonlySet<string>): Promise<void>;
}

export class VersionedFileSecretStore implements VersionedSecretPort {
  constructor(private readonly dataDir: string) {}

  async stage(
    namespace: FeatureSecretNamespace,
    values: Readonly<Record<string, string>>,
  ): Promise<string> {
    const revision = `secret-${randomUUID()}`;
    const normalized = normalizeSecretValues(values);
    const stagedPath = this.revisionPath(namespace, revision, true);
    await writeJsonFile(stagedPath, normalized, { mode: 0o600 });
    await chmod(stagedPath, 0o600).catch(() => undefined);
    return revision;
  }

  async read(
    namespace: FeatureSecretNamespace,
    revision: string,
  ): Promise<Readonly<Record<string, string>>> {
    const finalPath = this.revisionPath(namespace, revision, false);
    const stagedPath = this.revisionPath(namespace, revision, true);
    for (const candidate of [finalPath, stagedPath]) {
      try {
        return normalizeSecretValues(JSON.parse(await readFile(candidate, 'utf8')));
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') continue;
        throw error;
      }
    }
    throw new Error(`Referenced Feature secret revision is unavailable: ${revision}`);
  }

  async finalize(namespace: FeatureSecretNamespace, revision: string): Promise<void> {
    const stagedPath = this.revisionPath(namespace, revision, true);
    const finalPath = this.revisionPath(namespace, revision, false);
    if (await isRegularFile(finalPath)) {
      await rm(stagedPath, { force: true });
      return;
    }
    await renameWithRetry(stagedPath, finalPath);
    await chmod(finalPath, 0o600).catch(() => undefined);
  }

  async discard(namespace: FeatureSecretNamespace, revision: string): Promise<void> {
    await rm(this.revisionPath(namespace, revision, true), { force: true });
  }

  async recover(namespace: FeatureSecretNamespace, referencedRevision?: string): Promise<void> {
    const directory = this.namespaceDirectory(namespace);
    if (referencedRevision) {
      const finalPath = this.revisionPath(namespace, referencedRevision, false);
      const stagedPath = this.revisionPath(namespace, referencedRevision, true);
      if (!await isRegularFile(finalPath)) {
        if (!await isRegularFile(stagedPath)) {
          throw new Error(`Referenced Feature secret revision is unavailable: ${referencedRevision}`);
        }
        await this.finalize(namespace, referencedRevision);
      }
    }
    for (const entry of await directoryEntries(directory)) {
      if (!entry.endsWith('.staged.json')) continue;
      const revision = entry.slice(0, -'.staged.json'.length);
      if (revision !== referencedRevision) {
        await rm(path.join(directory, entry), { force: true });
      }
    }
  }

  async collect(
    namespace: FeatureSecretNamespace,
    retainedRevisions: ReadonlySet<string>,
  ): Promise<void> {
    const directory = this.namespaceDirectory(namespace);
    for (const entry of await directoryEntries(directory)) {
      if (!entry.endsWith('.json') || entry.endsWith('.staged.json')) continue;
      const revision = entry.slice(0, -'.json'.length);
      if (!retainedRevisions.has(revision)) {
        await rm(path.join(directory, entry), { force: true });
      }
    }
  }

  private namespaceDirectory(namespace: FeatureSecretNamespace): string {
    assertSafeSegment(namespace.featureId, 'FeatureId');
    assertSafeSegment(namespace.documentId, 'settings documentId');
    return path.join(this.dataDir, 'secrets', namespace.featureId, namespace.documentId);
  }

  private revisionPath(
    namespace: FeatureSecretNamespace,
    revision: string,
    staged: boolean,
  ): string {
    if (!REVISION_PATTERN.test(revision)) throw new Error(`Invalid Feature secret revision: ${revision}`);
    return path.join(
      this.namespaceDirectory(namespace),
      `${revision}${staged ? '.staged' : ''}.json`,
    );
  }
}

function normalizeSecretValues(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Feature secret revision must contain an object.');
  }
  const normalized: Record<string, string> = {};
  for (const [key, secret] of Object.entries(value)) {
    assertSafeSegment(key, 'Feature secret name');
    if (typeof secret !== 'string') throw new Error(`Feature secret "${key}" must be a string.`);
    normalized[key] = secret;
  }
  return Object.freeze(normalized);
}

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_PATTERN.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function directoryEntries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}
