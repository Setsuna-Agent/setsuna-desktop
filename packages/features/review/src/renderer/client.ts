import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readReviewSettings,
  readGitSettings,
  readGitConflictHistory,
  readArchivedGitConflicts,
  deleteGitConflictTask,
  setGitConflictArchived,
  resolveGitConflicts,
  startAgentReview,
  updateReviewSettings,
  updateGitSettings,
  type ReviewRendererService,
  type ReviewSettingsState,
  type ReviewSettingsUpdate,
  type StartReviewInput,
  type StartReviewResult,
} from '../contracts/index.js';

export type ReviewClient = Pick<ReviewRendererService, 'readGitSettings' | 'updateGitSettings' | 'resolveGitConflicts' | 'readGitConflictHistory' | 'setGitConflictArchived' | 'readArchivedGitConflicts' | 'deleteGitConflictTask'> & Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<ReviewSettingsState>;
  start(
    input: StartReviewInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<StartReviewResult>;
  updateSettings(
    input: ReviewSettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ReviewSettingsState>;
}>;

export function createReviewClient(transport: FeatureOperationTransport): ReviewClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readReviewSettings, undefined, options),
    deleteGitConflictTask: (input, options) => transport.call(deleteGitConflictTask, input, options),
    readArchivedGitConflicts: (options) => transport.call(readArchivedGitConflicts, undefined, options),
    readGitConflictHistory: (input, options) => transport.call(readGitConflictHistory, input, options),
    setGitConflictArchived: (input, options) => transport.call(setGitConflictArchived, input, options),
    resolveGitConflicts: (input, options) => transport.call(resolveGitConflicts, input, options),
    readGitSettings: (options) => transport.call(readGitSettings, undefined, options),
    updateGitSettings: (input, options) => transport.call(updateGitSettings, input, options),
    start: (input, options) => transport.call(startAgentReview, input, options),
    updateSettings: (input, options) => transport.call(updateReviewSettings, input, options),
  });
}
