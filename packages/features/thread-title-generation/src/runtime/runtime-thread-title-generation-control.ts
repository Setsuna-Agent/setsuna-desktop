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

  async start(input: ThreadTitleGenerationStartInput): Promise<void> {
    if (input.taskKind !== 'regular' || input.thread.title !== DEFAULT_THREAD_TITLE) return;
    if (input.thread.messages.some((message) => message.role === 'user' && message.visibility !== 'model')) {
      return;
    }

    // Generation and persistence share the Feature lifetime, independently of the
    // first answer's completion or cancellation. Feature shutdown still cancels both.
    await this.scope.runOperation(async (signal) => {
      const selection = (await this.settings.read()).value;
      const model = await this.host.resolveModel({
        selection,
        ...(input.conversationModel ? { fallback: input.conversationModel } : {}),
      });
      if (!model) return;
      signal.throwIfAborted();
      const generated = await generateThreadTitle({
        attachmentCount: input.attachmentCount,
        sessionId: input.thread.id,
        host: this.host,
        model: model.model,
        now: this.host.now(),
        ...(model.providerId ? { providerId: model.providerId } : {}),
        signal,
        userContent: input.userContent,
      });
      signal.throwIfAborted();
      if (generated.usage) await this.host.recordUsage(input.thread.id, input.turnId, generated.usage);
      if (generated.title) await this.commit(input, generated.title, signal);
    }).catch(() => undefined);
  }

  private async commit(
    input: ThreadTitleGenerationStartInput,
    title: string,
    signal: AbortSignal,
  ): Promise<void> {
    const threadId = input.thread.id;
    await this.host.flushThread(threadId);
    const eventsSinceTurnStart = await this.host.listEvents(threadId, input.thread.lastSeq);
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
    signal.throwIfAborted();
    await this.host.appendTitleUpdate(threadId, input.turnId, title);
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
