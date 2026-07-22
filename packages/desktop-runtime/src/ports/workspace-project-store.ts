import type {
  AddWorkspaceProjectInput,
  WorkspaceEntryList,
  WorkspaceEntrySearchResponse,
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

export type WorkspaceFileMetadata = {
  projectId: string;
  path: string;
  size: number;
  modifiedAt?: string;
};

export type TemporaryWorkspaceInput = {
  threadId: string;
  createdAt?: string;
};

export type WorkspaceProjectSearchOptions = {
  /** Optional latest-wins group selected by the concrete caller. */
  supersedeKey?: string;
  signal?: AbortSignal;
};

export type WorkspaceProjectStore = {
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  archiveProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  ensureTemporaryWorkspace(input: TemporaryWorkspaceInput): Promise<WorkspaceProject>;
  removeTemporaryWorkspace(input: TemporaryWorkspaceInput): Promise<void>;
  getStatus(projectId?: string): Promise<WorkspaceStatus>;
  listEntries(projectId: string, relativePath?: string): Promise<WorkspaceEntryList>;
  searchEntries(projectId: string, query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  inspectFile(projectId: string, relativePath: string): Promise<WorkspaceFileMetadata>;
  readFile(projectId: string, relativePath: string): Promise<WorkspaceFileRead>;
  readImage(projectId: string, relativePath: string): Promise<WorkspaceImageRead>;
  writeFile(projectId: string, relativePath: string, content: string): Promise<WorkspaceFileWrite>;
  writeBinaryFile(projectId: string, relativePath: string, content: Uint8Array): Promise<WorkspaceFileWrite>;
  deleteFile(projectId: string, relativePath: string): Promise<void>;
  search(projectId: string, query: string, options?: WorkspaceProjectSearchOptions): Promise<WorkspaceSearchResponse>;
};
