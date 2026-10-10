import type {
  AddWorkspaceProjectInput,
  UpdateWorkspaceProjectInput,
  WorkspaceEntry,
  WorkspaceEntryCreateInput,
  WorkspaceEntryRenameInput,
  WorkspaceEntryMoveInput,
  WorkspaceEntryList,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceFileChange,
  WorkspaceFileChangeAction,
  WorkspaceFileWrite,
  WorkspaceProject,
  WorkspaceProjectTarget,
  WorkspaceProjectList,
  WorkspaceSearchResponse,
  WorkspaceStatus,
} from '@setsuna-desktop/contracts';
import type { SafeImageMimeType } from '../utils/safe-image.js';

export type WorkspaceImageRead = {
  projectId: string;
  rootId?: string;
  path: string;
  mimeType: SafeImageMimeType;
  size: number;
  modifiedAt?: string;
  base64: string;
};

export type WorkspaceFileMetadata = {
  projectId: string;
  rootId?: string;
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

export type WorkspaceFileReadOptions = {
  maxTextBytes?: number;
};

export type WorkspaceProjectStore = {
  listProjects(): Promise<WorkspaceProjectList>;
  addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject>;
  updateProject(projectId: string, input: UpdateWorkspaceProjectInput): Promise<WorkspaceProject>;
  archiveProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  ensureTemporaryWorkspace(input: TemporaryWorkspaceInput): Promise<WorkspaceProject>;
  removeTemporaryWorkspace(input: TemporaryWorkspaceInput): Promise<void>;
  getStatus(projectId?: WorkspaceProjectTarget, sourceProjectId?: string): Promise<WorkspaceStatus>;
  listEntries(projectId: WorkspaceProjectTarget, relativePath?: string): Promise<WorkspaceEntryList>;
  createEntry(projectId: WorkspaceProjectTarget, input: WorkspaceEntryCreateInput): Promise<WorkspaceEntry>;
  renameEntry(projectId: WorkspaceProjectTarget, relativePath: string, input: WorkspaceEntryRenameInput): Promise<WorkspaceEntry>;
  moveEntry(projectId: WorkspaceProjectTarget, relativePath: string, input: WorkspaceEntryMoveInput): Promise<WorkspaceEntry>;
  deleteEntry(projectId: WorkspaceProjectTarget, relativePath: string): Promise<void>;
  searchEntries(projectId: WorkspaceProjectTarget, query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  inspectFile(projectId: WorkspaceProjectTarget, relativePath: string): Promise<WorkspaceFileMetadata>;
  readFile(
    projectId: WorkspaceProjectTarget,
    relativePath: string,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileRead>;
  readImage(projectId: WorkspaceProjectTarget, relativePath: string): Promise<WorkspaceImageRead>;
  writeFile(projectId: WorkspaceProjectTarget, relativePath: string, content: string): Promise<WorkspaceFileWrite>;
  writeBinaryFile(projectId: WorkspaceProjectTarget, relativePath: string, content: Uint8Array): Promise<WorkspaceFileWrite>;
  deleteFile(projectId: WorkspaceProjectTarget, relativePath: string): Promise<void>;
  applyFileChanges(projectId: WorkspaceProjectTarget, changes: WorkspaceFileChange[], action: WorkspaceFileChangeAction, persist?: () => Promise<void>): Promise<void>;
  search(projectId: WorkspaceProjectTarget, query: string, options?: WorkspaceProjectSearchOptions): Promise<WorkspaceSearchResponse>;
};
