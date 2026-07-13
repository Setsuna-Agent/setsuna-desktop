export const TEMPORARY_WORKSPACE_PROJECT_ID = 'temporary_workspace';

export type WorkspaceProject = {
  id: string;
  name: string;
  path: string;
  gitRoot?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceProjectList = {
  projects: WorkspaceProject[];
};

export type AddWorkspaceProjectInput = {
  path: string;
  name?: string;
};

export type WorkspaceStatus = {
  project?: WorkspaceProject;
  exists: boolean;
  readable: boolean;
  fileCount?: number;
  gitRoot?: string;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
};

export type WorkspaceEntryList = {
  basePath: string;
  entries: WorkspaceEntry[];
};

export type WorkspaceEntrySearchItem = {
  kind: WorkspaceEntry['type'];
  name: string;
  path: string;
  parent: string;
};

export type WorkspaceEntrySearchResponse = {
  entries: WorkspaceEntrySearchItem[];
  query: string;
  scanned: number;
  truncated: boolean;
  workspaceRoot: string;
};

export type WorkspaceFileRead = {
  projectId: string;
  path: string;
  content: string;
  size: number;
  modifiedAt?: string;
  truncated: boolean;
};

export type WorkspaceFileWrite = {
  projectId: string;
  path: string;
  size: number;
  modifiedAt?: string;
  created: boolean;
};

export type WorkspaceSearchResult = {
  path: string;
  line: number;
  preview: string;
};

export type WorkspaceSearchResponse = {
  query: string;
  results: WorkspaceSearchResult[];
  truncated: boolean;
};
