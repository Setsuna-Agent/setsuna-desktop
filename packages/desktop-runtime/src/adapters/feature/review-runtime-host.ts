import type {
  WorkspaceTaskTurnRequest,
  ReviewModelSelection,
  ReviewRuntimeHost,
  ReviewTextGenerationRequest,
  ReviewTurnRequest,
  StartReviewResult,
  SetGitConflictArchivedInput,
  DeleteGitConflictTaskInput,
} from '@setsuna-desktop/feature-review/contracts';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import { readReviewGitConflictContext, resolveReviewWorkspace } from './review-git-conflict-context.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';
import { resolveRuntimeTurnModel } from '../../loop/core/runtime-thread-model.js';
import { realpath } from 'node:fs/promises';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { ReviewConflictTaskStore } from './review-conflict-task-store.js';

type HostDependencies = Readonly<{
  dataDir: string;
  environments: RuntimeEnvironmentResolver;
  startWorkspaceTaskTurn(threadId: string, request: WorkspaceTaskTurnRequest): Promise<StartReviewResult>;
  activeTurnId(threadId: string): string | null;
  deleteWorkspaceTask(threadId: string): Promise<void>;
  config: Pick<ConfigStore, 'getActiveProviderConfig' | 'getConfig'>;
  models: Pick<ModelClient, 'stream'>;
  startTurn(threadId: string, request: ReviewTurnRequest): Promise<StartReviewResult>;
  threads: Pick<ThreadStore, 'getThread' | 'createThread' | 'deleteThread'>;
}>;

/** Adapts configured model references without exposing Core model clients to Review.
 * A model's enabled flag selects the provider default; other configured models remain selectable.
 */
export class DesktopReviewRuntimeHost implements ReviewRuntimeHost {
  private readonly taskStore: ReviewConflictTaskStore;
  constructor(private readonly dependencies: HostDependencies) {
    this.taskStore = new ReviewConflictTaskStore(dependencies.dataDir, dependencies.threads);
  }

  retainedWorkspaceTaskThreadIds() { return this.taskStore.retainedThreadIds(); }

  async deleteGitConflictTask({ workspaceRoot, threadId }: DeleteGitConflictTaskInput) {
    try {
      const result = await this.taskStore.deleteArchived(workspaceRoot, threadId, this.dependencies.deleteWorkspaceTask);
      if (result === 'not-archived') throw new FeatureOperationFailure({ code: 'CONFLICT_TASK_NOT_ARCHIVED', message: 'Only archived conflict records can be permanently deleted.', retryable: false });
      return { deleted: result === 'deleted' };
    } catch (error) {
      if (error instanceof FeatureOperationFailure) throw error;
      throw new FeatureOperationFailure({ code: 'CONFLICT_HISTORY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true });
    }
  }

  async listArchivedGitConflicts() {
    try { return await this.taskStore.listArchived(); }
    catch (error) {
      throw new FeatureOperationFailure({ code: 'CONFLICT_HISTORY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true });
    }
  }

  async listGitConflictTasks(workspaceRoot: string) {
    try { return await this.taskStore.list(workspaceRoot); }
    catch (error) {
      throw new FeatureOperationFailure({ code: 'CONFLICT_HISTORY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true });
    }
  }

  async setGitConflictArchived({ workspaceRoot, threadId, archived }: SetGitConflictArchivedInput) {
    try {
      const task = await this.taskStore.setArchived(workspaceRoot, threadId, archived);
      if (!task) throw new FeatureOperationFailure({ code: 'CONFLICT_TASK_NOT_FOUND', message: 'Conflict task was not found in this workspace.', retryable: false });
      return task;
    } catch (error) {
      if (error instanceof FeatureOperationFailure) throw error;
      throw new FeatureOperationFailure({ code: 'CONFLICT_HISTORY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true });
    }
  }

  async isDefaultModelConfigured(): Promise<boolean> {
    const provider = await this.dependencies.config.getActiveProviderConfig();
    return Boolean(
      provider?.enabled
      && provider.activeModel?.code
      && (provider.apiKey || provider.activeModel.code !== 'local-runtime-smoke'),
    );
  }

  async generateText(input: ReviewTextGenerationRequest): Promise<string> {
    const { modelSelection, onProgress, ...request } = input;
    let modelCode = 'local-runtime-smoke';
    if (modelSelection) {
      const config = await this.dependencies.config.getConfig();
      const provider = config.providers.find((item) => item.enabled && item.id === modelSelection.providerId);
      const model = provider?.models.find((item) => item.id === modelSelection.modelId);
      if (!model?.code.trim()) throw new Error('The selected commit message model is unavailable.');
      modelCode = model.code;
    }
    const collector = createModelStreamTextCollector(onProgress);
    for await (const event of this.dependencies.models.stream({
      ...request,
      // With no conversation or dedicated selection, the sentinel selects the global default.
      model: modelCode,
      ...(modelSelection ? { providerId: modelSelection.providerId } : {}),
    })) {
      collector.consume(event);
    }
    return collector.text();
  }

  readGitConflictContext(threadId: string, workspaceRoot: string) {
    return readReviewGitConflictContext(this.dependencies.threads, this.dependencies.environments, threadId, workspaceRoot);
  }

  async startWorkspaceTask(sourceThreadId: string, workspaceRoot: string, request: WorkspaceTaskTurnRequest) {
    const { thread: source, environment } = await resolveReviewWorkspace(this.dependencies.threads, this.dependencies.environments, sourceThreadId, workspaceRoot);
    const model = resolveRuntimeTurnModel(await this.dependencies.config.getConfig(), source, request.modelSelection);
    // Bind to the resolved workspace, including a source thread's temporary workspace.
    // Side threads stay out of chat lists. Review retains its own task threads
    // across restarts; no source messages or active-turn state are copied.
    const thread = await this.dependencies.threads.createThread({
      kind: 'side',
      title: request.title, projectId: environment.workspaceProjectId ?? environment.id,
      memoryMode: 'disabled', modelBinding: model?.binding,
    });
    try {
      await this.taskStore.retain({
        threadId: thread.id, workspaceRoot: await realpath(environment.workspaceRoot),
        operation: request.operation, createdAt: thread.createdAt,
      });
      const result = await this.dependencies.startWorkspaceTaskTurn(thread.id, request);
      return { threadId: thread.id, turnId: result.turnId, createdAt: thread.createdAt, operation: request.operation };
    } catch (error) {
      await this.dependencies.threads.deleteThread(thread.id);
      await this.taskStore.remove(thread.id);
      throw error;
    }
  }

  isWorkspaceTaskActive(threadId: string, turnId: string): boolean {
    return this.dependencies.activeTurnId(threadId) === turnId;
  }

  async hasThread(threadId: string): Promise<boolean> {
    return Boolean(await this.dependencies.threads.getThread(threadId));
  }

  async listModelOptions() {
    const config = await this.dependencies.config.getConfig().catch(() => null);
    if (!config) return [];
    return config.providers.flatMap((provider) => (
      provider.enabled
        ? provider.models.flatMap((model) => {
            const modelCode = model.code.trim();
            const modelId = model.id.trim();
            if (!modelCode || !modelId) return [];
            return [Object.freeze({
              providerId: provider.id,
              providerName: provider.name.trim() || provider.id,
              modelId,
              modelName: model.name,
              modelCode,
            })];
          })
        : []
    ));
  }

  async resolveModelSelection(input: Readonly<{
    fallback?: NonNullable<ReviewTurnRequest['modelSelection']>;
    selection: ReviewModelSelection;
  }>) {
    const config = await this.dependencies.config.getConfig().catch(() => null);
    if (input.selection && config) {
      const provider = config.providers.find((item) => (
        item.enabled && item.id === input.selection?.providerId
      ));
      const model = provider?.models.find((item) => (
        item.id === input.selection?.modelId && Boolean(item.code.trim())
      ));
      if (provider && model) {
        return Object.freeze({
          providerId: provider.id,
          modelId: model.id,
        });
      }
    }
    return input.fallback
      ? Object.freeze({ ...input.fallback })
      : undefined;
  }

  startTurn(threadId: string, request: ReviewTurnRequest): Promise<StartReviewResult> {
    return this.dependencies.startTurn(threadId, request);
  }
}
