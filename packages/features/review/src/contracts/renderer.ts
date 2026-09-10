import type { RuntimeReviewFinding } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { StartReviewInput, StartReviewResult } from './agent-review.js';
import type { GitSettingsState, GitSettingsUpdate } from './git-settings.js';
import type { DeleteGitConflictTaskInput, DeleteGitConflictTaskResult, WorkspaceGitConflictTask, GitConflictTaskRecord, ReadGitConflictHistoryInput, SetGitConflictArchivedInput, ResolveGitConflictsInput, ResolveGitConflictsResult } from './conflict-resolution.js';

export type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';

export type DesktopReviewFocusRequest = {
  finding?: RuntimeReviewFinding;
  line?: number;
  path: string;
  version: number;
};

export type DesktopReviewOpenHandler = (
  filePath?: string,
  line?: number,
  finding?: RuntimeReviewFinding,
) => void;

export interface ReviewRendererService {
  readonly available: boolean;
  deleteGitConflictTask(input: DeleteGitConflictTaskInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<DeleteGitConflictTaskResult>;
  readArchivedGitConflicts(options?: Readonly<{ signal?: AbortSignal }>): Promise<readonly WorkspaceGitConflictTask[]>;
  readGitConflictHistory(input: ReadGitConflictHistoryInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<readonly GitConflictTaskRecord[]>;
  setGitConflictArchived(input: SetGitConflictArchivedInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<GitConflictTaskRecord>;
  readGitSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<GitSettingsState>;
  updateGitSettings(input: GitSettingsUpdate, options?: Readonly<{ signal?: AbortSignal }>): Promise<GitSettingsState>;
  resolveGitConflicts(input: ResolveGitConflictsInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<ResolveGitConflictsResult>;
  start(
    input: StartReviewInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<StartReviewResult>;
}

export const reviewRendererServiceCapability: CapabilityToken<ReviewRendererService> = defineCapability({
  id: 'desktop-review.renderer-service',
  description: 'Typed renderer entrypoint for Agent Review, Git settings, and conflict resolution',
});

export function createNoopReviewRendererService(): ReviewRendererService {
  const unavailable = async (): Promise<never> => {
    throw new FeatureOperationFailure({
      code: 'FEATURE_UNAVAILABLE',
      message: 'Review Feature is unavailable.',
      retryable: true,
    });
  };
  return Object.freeze({
    available: false,
    start: unavailable,
    readGitConflictHistory: unavailable,
    readArchivedGitConflicts: unavailable,
    deleteGitConflictTask: unavailable,
    setGitConflictArchived: unavailable,
    resolveGitConflicts: unavailable,
    readGitSettings: unavailable,
    updateGitSettings: unavailable,
  });
}
