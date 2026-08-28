import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export const PUBLISH_ARTIFACT_TOOL_NAME = 'publish_artifact';

/** A verified user-facing deliverable inside a runtime-managed workspace. */
export type RuntimeArtifact = Readonly<{
  id: string;
  kind: 'file';
  name: string;
  projectId: string;
  workspaceRoot: string;
  path: string;
  mimeType: string;
  size: number;
  modifiedAt?: string;
}>;

export const artifactResultCodec = defineRuntimeCodec<RuntimeArtifact>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Artifact result must be an object.');
  }
  const artifact = value as Record<string, unknown>;
  if (artifact.kind !== 'file') throw new Error('Artifact kind is invalid.');
  const id = requiredText(artifact.id, 'id');
  const name = requiredText(artifact.name, 'name');
  const projectId = requiredText(artifact.projectId, 'projectId');
  const workspaceRoot = requiredText(artifact.workspaceRoot, 'workspaceRoot');
  const artifactPath = requiredText(artifact.path, 'path');
  const mimeType = requiredText(artifact.mimeType, 'mimeType');
  if (!isAbsolutePath(workspaceRoot)) throw new Error('Artifact workspaceRoot must be absolute.');
  if (!isSafeRelativePath(artifactPath)) throw new Error('Artifact path must stay inside its workspace.');
  if (typeof artifact.size !== 'number' || !Number.isFinite(artifact.size) || artifact.size < 0) {
    throw new Error('Artifact size is invalid.');
  }
  if (artifact.modifiedAt !== undefined && typeof artifact.modifiedAt !== 'string') {
    throw new Error('Artifact modifiedAt is invalid.');
  }
  return Object.freeze({
    id,
    kind: 'file',
    name,
    projectId,
    workspaceRoot,
    path: artifactPath,
    mimeType,
    size: artifact.size,
    ...(artifact.modifiedAt === undefined ? {} : { modifiedAt: artifact.modifiedAt }),
  });
});

export function artifactResultEnvelope(payload: RuntimeArtifact): Readonly<{
  resultKind: 'artifact.file';
  resultMajor: 1;
  payload: RuntimeArtifact;
}> {
  return Object.freeze({
    resultKind: 'artifact.file',
    resultMajor: 1,
    payload: artifactResultCodec.parse(payload),
  });
}

export function isLegacyArtifactResult(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'artifact' in value
    && (value as { artifact?: unknown }).artifact
    && typeof (value as { artifact?: unknown }).artifact === 'object',
  );
}

/** Reads the unversioned `{ artifact }` tool data persisted before Feature result envelopes. */
export const legacyArtifactResultCodec = defineRuntimeCodec<RuntimeArtifact>((value) => {
  if (!isLegacyArtifactResult(value)) throw new Error('Legacy Artifact result is invalid.');
  return artifactResultCodec.parse((value as { artifact: unknown }).artifact);
});

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Artifact ${field} is invalid.`);
  return value;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/u.test(value);
}

function isSafeRelativePath(value: string): boolean {
  if (isAbsolutePath(value)) return false;
  return !value.replace(/\\/gu, '/').split('/').includes('..');
}
