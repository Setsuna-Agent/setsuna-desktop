export type WorkspaceTextSearchMatch = {
  path: string;
  lineNumber: number;
  column: number;
  line: string;
  before: string[];
  beforeStart: number;
  after: string[];
};

export type WorkspaceTextSearchRequest = {
  root: string;
  scopePath?: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  contextLines: number;
  maxResults: number;
  excludeRoots?: readonly string[];
  excludeGlobs?: readonly string[];
  signal?: AbortSignal;
};

export type WorkspaceTextSearchResponse = {
  query: string;
  matches: WorkspaceTextSearchMatch[];
  truncated: boolean;
  engine: 'ripgrep' | 'javascript';
  scannedFiles?: number;
};

export interface WorkspaceSearchEngine {
  search(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResponse>;
}

export class WorkspaceSearchCancelledError extends Error {
  constructor(message = 'Workspace search was cancelled.') {
    super(message);
    this.name = 'WorkspaceSearchCancelledError';
  }
}
