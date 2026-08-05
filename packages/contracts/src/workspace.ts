export const TEMPORARY_WORKSPACE_PROJECT_ID = 'temporary_workspace';
export const TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX = `${TEMPORARY_WORKSPACE_PROJECT_ID}.`;

export type TemporaryWorkspaceProjectReference = {
  date: string;
  threadId: string;
};

/** Build the opaque workspace id used for one conversation's date-grouped temporary directory. */
export function temporaryWorkspaceProjectId({ date, threadId }: TemporaryWorkspaceProjectReference): string {
  return `${TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX}${date}.${threadId}`;
}

export function parseTemporaryWorkspaceProjectId(projectId: string): TemporaryWorkspaceProjectReference | null {
  if (!projectId.startsWith(TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX)) return null;
  const value = projectId.slice(TEMPORARY_WORKSPACE_PROJECT_ID_PREFIX.length);
  const separator = value.indexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  const date = value.slice(0, separator);
  const threadId = value.slice(separator + 1);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) ? { date, threadId } : null;
}

export function isTemporaryWorkspaceProjectId(projectId: string): boolean {
  return projectId === TEMPORARY_WORKSPACE_PROJECT_ID || parseTemporaryWorkspaceProjectId(projectId) !== null;
}

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

export type WorkspaceStatusQuery = {
  projectId?: string;
  threadId?: string;
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

export type WorkspaceFilePreviewImageMimeType =
  | 'image/bmp'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/svg+xml'
  | 'image/webp'
  | 'image/x-icon';

export type WorkspaceFilePreview =
  | { kind: 'text' }
  | { kind: 'image'; base64: string; mimeType: WorkspaceFilePreviewImageMimeType }
  | { kind: 'unsupported'; reason: 'binary' | 'image-too-large' };

/** Maximum text prefix returned by the lightweight file preview request. */
export const WORKSPACE_TEXT_FILE_MAX_BYTES = 256 * 1024;

/** Maximum complete text file loaded into and saved from the workspace editor. */
export const WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES = 8 * 1024 * 1024;

export type WorkspaceFileRead = {
  projectId: string;
  path: string;
  content: string;
  size: number;
  modifiedAt?: string;
  /** Content hash used for optimistic concurrency when saving an editor draft. */
  revision?: string;
  /** Optional for compatibility with runtimes that predate typed file previews. */
  preview?: WorkspaceFilePreview;
  truncated: boolean;
};

export type WorkspaceFileSaveInput = {
  content: string;
  expectedRevision: string;
};

export type WorkspaceFileWrite = {
  projectId: string;
  path: string;
  size: number;
  modifiedAt?: string;
  revision?: string;
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
  /** A newer request in the same caller-owned search group replaced this one. */
  superseded?: boolean;
};
