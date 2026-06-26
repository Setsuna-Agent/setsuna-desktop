import type {
  AddWorkspaceProjectInput,
  WorkspaceEntrySearchResponse,
  WorkspaceEntryList,
  WorkspaceFileRead,
  WorkspaceFileWrite,
  WorkspaceProject,
  WorkspaceProjectList,
  WorkspaceSearchResponse,
  WorkspaceStatus,
} from '@setsuna-desktop/contracts';

export type WorkspaceProjectStore = {
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  removeProject(projectId: string): Promise<void>;
  getStatus(projectId?: string): Promise<WorkspaceStatus>;
  listEntries(projectId: string, relativePath?: string): Promise<WorkspaceEntryList>;
  searchEntries(projectId: string, query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  readFile(projectId: string, relativePath: string): Promise<WorkspaceFileRead>;
  writeFile(projectId: string, relativePath: string, content: string): Promise<WorkspaceFileWrite>;
  search(projectId: string, query: string): Promise<WorkspaceSearchResponse>;
};
