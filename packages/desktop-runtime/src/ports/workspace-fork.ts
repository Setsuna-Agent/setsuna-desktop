import type { WorkspaceProject } from '@setsuna-desktop/contracts';

export type CreatedWorkspaceFork = {
  workspaceId: string;
  path: string;
  /** Only for rolling back a failed creation before the workspace reaches the user. */
  rollback(): Promise<void>;
};

export type WorkspaceFork = {
  createWorktree(workspacePath: string, project?: WorkspaceProject): Promise<CreatedWorkspaceFork>;
  /** Resolves managed workspaces without registering sidebar projects. */
  getWorkspace(workspaceId: string, sourceProject?: WorkspaceProject): Promise<(WorkspaceProject & { sourceProjectId?: string }) | undefined>;
};
