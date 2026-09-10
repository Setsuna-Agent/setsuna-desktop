import type {
  ReviewRendererService,
  GitSettingsUpdate,
  ResolveGitConflictsInput,
  ReadGitConflictHistoryInput,
  SetGitConflictArchivedInput,
  DeleteGitConflictTaskInput,
  StartReviewInput,
} from '../contracts/index.js';
import type { ReviewClient } from './client.js';

export class RendererReviewService implements ReviewRendererService {
  readonly available = true;

  constructor(private readonly client: Pick<ReviewClient, 'start' | 'readGitSettings' | 'updateGitSettings' | 'resolveGitConflicts' | 'readGitConflictHistory' | 'setGitConflictArchived' | 'readArchivedGitConflicts' | 'deleteGitConflictTask'>) {}

  deleteGitConflictTask(input: DeleteGitConflictTaskInput, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.deleteGitConflictTask(input, options);
  }

  readArchivedGitConflicts(options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.readArchivedGitConflicts(options);
  }

  readGitConflictHistory(input: ReadGitConflictHistoryInput, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.readGitConflictHistory(input, options);
  }

  setGitConflictArchived(input: SetGitConflictArchivedInput, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.setGitConflictArchived(input, options);
  }

  readGitSettings(options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.readGitSettings(options);
  }

  updateGitSettings(input: GitSettingsUpdate, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.updateGitSettings(input, options);
  }

  resolveGitConflicts(input: ResolveGitConflictsInput, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.client.resolveGitConflicts(input, options);
  }

  start(
    input: StartReviewInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    return this.client.start(input, options);
  }
}
