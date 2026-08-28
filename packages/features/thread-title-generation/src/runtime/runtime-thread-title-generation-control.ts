import {
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
} from '@setsuna-desktop/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import {
  FeatureSettingsRevisionConflictError,
  type RuntimeFeatureSettingsDocumentHandle,
} from '@setsuna-desktop/feature-core/settings';
import type {
  ThreadTitleGeneration,
  ThreadTitleGenerationControl,
  ThreadTitleGenerationModelSelection,
  ThreadTitleGenerationRuntimeHost,
  ThreadTitleGenerationSettingsState,
  ThreadTitleGenerationSettingsUpdate,
  ThreadTitleGenerationStartInput,
} from '../contracts/index.js';
import { generateThreadTitle } from './thread-title-generator.js';

type SelectionHandle = Pick<RuntimeFeatureSettingsDocumentHandle<
  ThreadTitleGenerationModelSelection,
  ThreadTitleGenerationModelSelection,
  ThreadTitleGenerationModelSelection,
  undefined
>, 'read' | 'readPublic' | 'update'>;

export class RuntimeThreadTitleGenerationControl implements ThreadTitleGenerationControl {
  readonly available = true;

  constructor(
    private readonly scope: FeatureScope,
    private readonly settings: SelectionHandle,
    private readonly host: ThreadTitleGenerationRuntimeHost,
  ) {}

  async readSettings(): Promise<ThreadTitleGenerationSettingsState> {
    try {
      const [current, availableModels] = await Promise.all([
        this.settings.readPublic(),
        this.host.listModelOptions(),
      ]);
      return Object.freeze({
        selection: current.value,
        revision: current.revision,
        availableModels,
      });
    } catch (error) {
      throw settingsFailure(error);
    }
  }

  async updateSettings(
    input: ThreadTitleGenerationSettingsUpdate,
  ): Promise<ThreadTitleGenerationSettingsState> {
    try {
      await this.settings.update({
        expectedRevision: input.expectedRevision,
        patch: input.selection,
      });
      return this.readSettings();
    } catch (error) {
      throw settingsFailure(error);
    }
  }

  start(input: ThreadTitleGenerationStartInput): ThreadTitleGeneration | null {
    if (input.taskKind !== 'regular' || input.thread.title !== DEFAULT_THREAD_TITLE) return null;
    if (input.thread.messages.some((message) => message.role === 'user' && message.visibility !== 'model')) {
      return null;
    }

    const result = this.scope.runOperation(async (signal) => {
      const selection = (await this.settings.read()).value;
      const model = await this.host.resolveModel({
        selection,
        ...(input.conversationModel ? { fallback: input.conversationModel } : {}),
      });
      if (!model) return null;
      return generateThreadTitle({
        attachmentCount: input.attachmentCount,
        host: this.host,
        model: model.model,
        now: this.host.now(),
        ...(model.providerId ? { providerId: model.providerId } : {}),
        signal,
        userContent: input.userContent,
      });
    }, { signal: input.signal }).catch(() => null);

    return Object.freeze({
      initialSeq: input.thread.lastSeq,
      result,
    });
  }

  async commit(
    threadId: string,
    turnId: string,
    generation: ThreadTitleGeneration | null | undefined,
  ): Promise<void> {
    if (!generation) return;
    const generated = await generation.result;
    if (!generated) return;
    if (generated.usage) await this.host.recordUsage(threadId, turnId, generated.usage);
    if (!generated.title) return;

    await this.host.flushThread(threadId);
    const eventsSinceTurnStart = await this.host.listEvents(threadId, generation.initialSeq);
    const explicitlyRenamed = eventsSinceTurnStart.some((event) => (
      event.type === 'thread.updated'
      && typeof event.payload.title === 'string'
      && event.payload.title.trim()
    ));
    if (explicitlyRenamed) return;

    const current = await this.host.getThread(threadId);
    const fallback = current?.messages.find((message) => (
      message.role === 'user' && message.visibility !== 'model'
    ));
    if (
      !current
      || !fallback
      || current.title !== fallbackThreadTitle(fallback.content, fallback.attachments?.length)
    ) return;
    await this.host.appendTitleUpdate(threadId, turnId, generated.title);
  }
}

function settingsFailure(error: unknown): FeatureOperationFailure {
  if (error instanceof FeatureOperationFailure) return error;
  if (error instanceof FeatureSettingsRevisionConflictError) {
    return new FeatureOperationFailure({
      code: 'REVISION_CONFLICT',
      message: 'Thread title generation settings changed. Reload before saving again.',
      retryable: true,
    });
  }
  return new FeatureOperationFailure({
    code: 'SETTINGS_UNAVAILABLE',
    message: 'Thread title generation settings are unavailable.',
    retryable: true,
  });
}
