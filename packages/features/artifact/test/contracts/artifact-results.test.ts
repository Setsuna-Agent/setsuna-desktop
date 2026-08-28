import { describe, expect, it } from 'vitest';
import {
  artifactResultCodec,
  artifactResultEnvelope,
  legacyArtifactResultCodec,
  type RuntimeArtifact,
} from '../../src/contracts/index.js';

const artifact: RuntimeArtifact = {
  id: 'artifact_1',
  kind: 'file',
  name: 'report.pdf',
  projectId: 'project_1',
  workspaceRoot: '/workspace/project',
  path: 'output/report.pdf',
  mimeType: 'application/pdf',
  size: 128,
};

describe('Artifact tool results', () => {
  it('creates a versioned result and upgrades the persisted legacy shape', () => {
    expect(artifactResultEnvelope(artifact)).toEqual({
      resultKind: 'artifact.file',
      resultMajor: 1,
      payload: artifact,
    });
    expect(legacyArtifactResultCodec.parse({ artifact })).toEqual(artifact);
  });

  it('rejects a persisted artifact path that escapes its workspace', () => {
    expect(() => artifactResultCodec.parse({ ...artifact, path: '../secret.pdf' })).toThrow(
      'must stay inside its workspace',
    );
  });
});
