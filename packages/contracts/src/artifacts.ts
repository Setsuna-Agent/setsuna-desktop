export const PUBLISH_ARTIFACT_TOOL_NAME = 'publish_artifact';

/** A user-facing file produced by a runtime turn and kept inside its workspace. */
export type RuntimeArtifact = {
  id: string;
  kind: 'file';
  name: string;
  projectId: string;
  workspaceRoot: string;
  path: string;
  mimeType: string;
  size: number;
  modifiedAt?: string;
};

export type RuntimeArtifactToolData = {
  artifact: RuntimeArtifact;
};
