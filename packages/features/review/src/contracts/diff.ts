export type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed' | 'gap';
  lineNumber: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DesktopDiffFile = {
  path: string;
  /** Original repository path for renamed files. */
  previousPath?: string;
  action: string;
  additions: number;
  deletions: number;
  /** Non-text files are listed without ever decoding their bytes into text diff lines. */
  contentKind?: 'binary' | 'image';
  truncated: boolean;
  lines: DesktopDiffLine[];
  /** Original unified patch for complete previews; omitted when truncated. */
  patch?: string;
};

export type DesktopDiffSummary = {
  files: DesktopDiffFile[];
  additions: number;
  deletions: number;
};
