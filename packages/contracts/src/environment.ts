/**
 * Serializable description of the local environment selected for one runtime
 * operation. Permissions intentionally live outside this value: this describes
 * where execution happens, not what the caller may access.
 */
export type RuntimeEnvironment = {
  id: string;
  /** Default working directory for shell commands. */
  cwd: string;
  /** Primary base used by workspace-relative file tools. */
  workspaceRoot: string;
  /** Semantic workspace roots. The primary workspace root is always first. */
  workspaceRoots: string[];
  /** Actual shell executable used by the local command runner when known. */
  shell?: string;
  repository?: RuntimeGitRepositoryEnvironment;
};

export type RuntimeGitRepositoryEnvironment = {
  kind: 'git';
  /** Git worktree top-level directory, which may be outside the workspace. */
  root: string;
  /** POSIX-style path from repository root to workspaceRoot; `.` at the root. */
  workspacePrefix: string;
};
