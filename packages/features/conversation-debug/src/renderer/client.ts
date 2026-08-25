import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  listConversationDebugEvents,
  listConversationDebugTraces,
  readConversationDebugSettings,
  updateConversationDebugSettings,
  type ConversationDebugEventPage,
  type ConversationDebugSettingsState,
  type ConversationDebugSettingsUpdate,
  type RuntimeDebugTraceList,
} from '../contracts/index.js';

export type ConversationDebugClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<ConversationDebugSettingsState>;
  updateSettings(input: ConversationDebugSettingsUpdate): Promise<ConversationDebugSettingsState>;
  listEvents(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ConversationDebugEventPage>;
  listTraces(threadId: string, afterSeq?: number): Promise<RuntimeDebugTraceList>;
}>;

export function createConversationDebugClient(
  transport: FeatureOperationTransport,
): ConversationDebugClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readConversationDebugSettings, undefined, options),
    updateSettings: (input) => transport.call(updateConversationDebugSettings, input),
    listEvents: (threadId, input, options) => transport.call(listConversationDebugEvents, {
      afterSeq: String(Math.max(0, Math.floor(input.afterSeq))),
      limit: String(Math.max(1, Math.floor(input.limit))),
      threadId,
      throughSeq: String(Math.max(0, Math.floor(input.throughSeq))),
    }, options),
    listTraces: (threadId, afterSeq = 0) => transport.call(listConversationDebugTraces, {
      threadId,
      afterSeq: String(Math.max(0, Math.floor(afterSeq))),
    }),
  });
}
