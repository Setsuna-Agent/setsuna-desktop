import {
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  type RuntimeMessage,
  type RuntimeTaskKind,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { ConfigStore } from '../ports/config-store.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ModelClient } from '../ports/model-client.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { UsageStore } from '../ports/usage-store.js';
import type { RuntimeEventWriter } from './runtime-event-writer.js';
import { generateThreadTitle, type GeneratedThreadTitle } from './runtime-thread-title-generator.js';

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

/** Owns the complete auto-title policy, including fallback and rename races. */
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

    const result = this.options.configStore?.getActiveProviderConfig()
      .then((provider) => {
        const model = provider?.enabled ? provider.activeModel?.code.trim() : '';
        const usable = Boolean(model && (provider?.apiKey || model !== 'local-runtime-smoke'));
        if (!model || !usable) return null;
        return generateThreadTitle({
          attachmentCount: attachments.length,
          maxOutputTokens: Math.max(1, Math.min(96, provider?.activeModel?.maxOutputTokens ?? 96)),
          model,
          modelClient: this.options.modelClient,
          signal,
          userContent,
        });
      })
      .catch(() => null);
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
