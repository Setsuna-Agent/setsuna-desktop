import type { RuntimeConfiguredModelReference, RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { ReviewTurnRequest } from './agent-review.js';

export type ResolveGitConflictsInput = Readonly<{
  threadId: string;
  workspaceRoot: string;
  operation?: GitConflictOperation;
  modelSelection?: RuntimeConfiguredModelReference;
  language?: RuntimeInterfaceLanguage;
}>;
export type ResolveGitConflictsResult =
  | (Readonly<{ started: true }> & GitConflictTaskRecord)
  | Readonly<{ started: false; reason: 'disabled' | 'no-conflicts' }>;

export type WorkspaceTaskStartResult = Readonly<{ threadId: string; turnId: string }>;
export type GitConflictOperation = 'pull' | 'rebase' | 'sync';
export type GitConflictTaskRecord = WorkspaceTaskStartResult & Readonly<{
  createdAt: string;
  operation: GitConflictOperation;
  /** Older records without this field are unarchived. */
  archived?: boolean;
}>;
export type WorkspaceGitConflictTask = GitConflictTaskRecord & Readonly<{ workspaceRoot: string }>;
export type ReadGitConflictHistoryInput = Readonly<{ workspaceRoot: string }>;
export type DeleteGitConflictTaskInput = ReadGitConflictHistoryInput & Readonly<{ threadId: string }>;
export type DeleteGitConflictTaskResult = Readonly<{ deleted: boolean }>;
export type SetGitConflictArchivedInput = ReadGitConflictHistoryInput & Readonly<{ threadId: string; archived: boolean }>;

/** A hidden workspace task reuses ordinary tools, events, and cancellation. */
export type WorkspaceTaskTurnRequest = Pick<ReviewTurnRequest,
  'developerInstructions' | 'displayText' | 'modelSelection' | 'prompt'
> & Readonly<{ title: string; operation: GitConflictOperation }>;
export type GitConflictContext = Readonly<{ repositoryRoot: string; files: readonly string[] }>;
