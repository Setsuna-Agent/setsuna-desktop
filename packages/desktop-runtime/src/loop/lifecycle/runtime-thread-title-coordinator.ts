import {
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  type RuntimeConfigState,
  type RuntimeMessage,
  type RuntimeTaskKind,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageStore } from '../../ports/usage-store.js';
import { runtimeTaskModelRequest } from '../core/runtime-task-model.js';
import type { RuntimeEventWriter } from './runtime-event-writer.js';
import {
  generateThreadTitle,
  type GeneratedThreadTitle,
} from './runtime-thread-title-generator.js';

export type RuntimeThreadTitleGeneration = {
  initialSeq: number;
  result: Promise<GeneratedThreadTitle | null>;
};

type RuntimeThreadTitleCoordinatorOptions = {
  clock: Clock;
  configStore?: ConfigStore;
  eventWriter: Pick<RuntimeEventWriter, 'flushThread'>;
  ids: IdGenerator;
  modelClient: ModelClient;
  threadStore: ThreadStore;
  usageStore?: UsageStore;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** 管理完整的自动标题策略，包括回退逻辑与重命名竞态。 */
export class RuntimeThreadTitleCoordinator {
  constructor(private readonly options: RuntimeThreadTitleCoordinatorOptions) {}

  start({
    attachments,
    signal,
    taskKind,
    thread,
    userContent,
  }: {
    attachments: NonNullable<RuntimeMessage['attachments']>;
    signal: AbortSignal;
    taskKind: RuntimeTaskKind;
    thread: RuntimeThread;
    userContent: string;
  }): RuntimeThreadTitleGeneration | null {
    if (taskKind !== 'regular' || thread.title !== DEFAULT_THREAD_TITLE) return null;
    if (thread.messages.some((message) => message.role === 'user' && message.visibility !== 'model')) return null;

    const result = this.options.configStore
      ? Promise.all([
          this.options.configStore.getConfig(),
          this.options.configStore.getActiveProviderConfig(),
        ])
        .then(([config, activeProvider]) => {
          const selection = threadTitleModelSelection(config, activeProvider);
          if (!selection) return null;
          return generateThreadTitle({
            attachmentCount: attachments.length,
            model: selection.model,
            modelClient: this.options.modelClient,
            ...(selection.providerId ? { providerId: selection.providerId } : {}),
            signal,
            userContent,
          });
        })
        .catch(() => null)
      : undefined;
    return result ? { initialSeq: thread.lastSeq, result } : null;
  }

  async commit(threadId: string, turnId: string, generation: RuntimeThreadTitleGeneration | null | undefined): Promise<void> {
    if (!generation) return;
    const generated = await generation.result;
    if (!generated) return;
    if (generated.usage) {
      await this.options.usageStore?.recordUsage({
        threadId,
        turnId,
        createdAt: this.options.clock.now().toISOString(),
        ...generated.usage,
      });
    }
    if (!generated.title) return;

    await this.options.eventWriter.flushThread(threadId);
    const eventsSinceTurnStart = await this.options.threadStore.listEvents(threadId, generation.initialSeq);
    const explicitlyRenamed = eventsSinceTurnStart.some((event) =>
      event.type === 'thread.updated' && typeof event.payload.title === 'string' && event.payload.title.trim(),
    );
    if (explicitlyRenamed) return;

    const current = await this.options.threadStore.getThread(threadId);
    const fallback = current?.messages.find((message) => message.role === 'user' && message.visibility !== 'model');
    if (!current || !fallback || current.title !== fallbackThreadTitle(fallback.content, fallback.attachments?.length)) return;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'thread.updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: { title: generated.title },
    });
  }
}

function threadTitleModelSelection(
  config: RuntimeConfigState,
  activeProvider: RuntimeProviderConfig | null,
): { model: string; providerId?: string } | null {
  const fallbackModel = activeProvider?.enabled ? activeProvider.activeModel?.code.trim() : '';
  const request = runtimeTaskModelRequest(config, 'threadTitle', fallbackModel || '');
  const model = request.model.trim();
  if (!model) return null;

  if (request.providerId) {
    const reference = config.taskModels?.threadTitle;
    const provider = config.providers.find((item) => item.enabled && item.id === request.providerId);
    const configuredModel = reference && provider && reference.providerId === provider.id
      ? provider.models.find((item) => item.id === reference.modelId && item.code.trim() === model)
      : undefined;
    const usable = Boolean(
      provider
      && configuredModel
      && (provider.apiKeySet || model !== 'local-runtime-smoke'),
    );
    if (!usable || !configuredModel || !provider) return null;
    return {
      model,
      providerId: provider.id,
    };
  }

  const usable = Boolean(
    activeProvider?.enabled
    && activeProvider.activeModel?.code.trim() === model
    && (activeProvider.apiKey || model !== 'local-runtime-smoke'),
  );
  if (!usable || !activeProvider?.activeModel) return null;
  return {
    model,
  };
}
