export const PUBLISH_ARTIFACT_TOOL_NAME = 'publish_artifact';

/** runtime 轮次生成并保存在其工作区内、面向用户的文件。 */
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
