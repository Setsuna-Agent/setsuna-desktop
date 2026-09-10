import type { DesktopDiffFile } from './diff.js';

export type DesktopGitRef = {
  name: string;
  label: string;
  kind: 'local' | 'remote' | 'tag';
  oid: string;
};

export type DesktopGitCommit = {
  oid: string;
  parents: string[];
  subject: string;
  author: string;
  authoredAt: string;
};

export type DesktopGitHistoryOptions = {
  /** A ref on the first page; use the returned tip for stable subsequent pages. */
  ref?: string;
  skip?: number;
  limit?: number;
};

export type DesktopGitHistoryPage = {
  gitRoot: string | null;
  head: string | null;
  currentBranch: string | null;
  refs: DesktopGitRef[];
  tip: string | null;
  commits: DesktopGitCommit[];
  nextSkip: number | null;
};

export type DesktopGitChangedFile = Pick<
  DesktopDiffFile,
  'path' | 'previousPath' | 'action' | 'additions' | 'deletions' | 'contentKind'
>;

export type DesktopGitCommitDetails = {
  commit: DesktopGitCommit;
  /** Full subject and body; loaded with details rather than every history page. */
  message: string;
  /** Public web URL derived from the origin remote, without credentials. */
  githubUrl: string | null;
  /** Merge commits compare against their first parent; root commits have no before version. */
  baseOid: string | null;
  files: DesktopGitChangedFile[];
};

export type DesktopGitCommitFileInput = {
  oid: string;
  filePath: string;
  previousPath?: string;
};
