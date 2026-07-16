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
import type { SafeImageMimeType } from '../utils/safe-image.js';

export type WorkspaceImageRead = {
  projectId: string;
  path: string;
  mimeType: SafeImageMimeType;
  size: number;
  modifiedAt?: string;
  base64: string;
};

export type WorkspaceProjectStore = {
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  archiveProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  getStatus(projectId?: string): Promise<WorkspaceStatus>;
  listEntries(projectId: string, relativePath?: string): Promise<WorkspaceEntryList>;
  searchEntries(projectId: string, query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  readFile(projectId: string, relativePath: string): Promise<WorkspaceFileRead>;
  readImage(projectId: string, relativePath: string): Promise<WorkspaceImageRead>;
  writeFile(projectId: string, relativePath: string, content: string): Promise<WorkspaceFileWrite>;
  search(projectId: string, query: string): Promise<WorkspaceSearchResponse>;
};
