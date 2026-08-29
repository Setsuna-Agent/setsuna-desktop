import type {
  PendingStoredThreadEvent,
  RuntimeMessage,
  RuntimeMessageAttachment,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadModelBinding,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';

export interface SideConversationRuntimeHost {
  now(): Date;
  id(prefix: string): string;
  flushThread(threadId: string): Promise<void>;
  listThreads(): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  createThread(input: Readonly<{
    forkedFromId: string;
    kind: 'side';
    memoryMode: RuntimeThreadMemoryMode;
    modelBinding?: RuntimeThreadModelBinding;
    projectId?: string;
    title: string;
  }>): Promise<RuntimeThread>;
  retainAttachments(
    threadId: string,
    attachments: readonly RuntimeMessageAttachment[],
  ): Promise<void>;
  appendEvent(threadId: string, event: PendingStoredThreadEvent): Promise<void>;
  copyMessages(
    sourceThreadId: string,
    destinationThreadId: string,
    messages: readonly RuntimeMessage[],
  ): Promise<void>;
  rollbackCreatedThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
}

export const sideConversationRuntimeHostCapability: CapabilityToken<SideConversationRuntimeHost> = defineCapability({
  id: 'side-conversation.runtime-host',
  description: 'Narrow thread, attachment, and cleanup services required by the Side Conversation runtime Feature',
});

export interface SideConversationRendererHost {
  getThread(threadId: string): Promise<RuntimeThread>;
  deleteThread(threadId: string): Promise<void>;
}

export const sideConversationRendererHostCapability: CapabilityToken<SideConversationRendererHost> = defineCapability({
  id: 'side-conversation.renderer-host',
  description: 'Generic thread read and deletion services used by the Side Conversation renderer Feature',
});

export interface SideConversationRendererService {
  readonly available: boolean;
  create(
    parentThreadId: string,
    isCurrentOwner?: () => boolean,
  ): Promise<RuntimeThread>;
  discard(threadId: string): Promise<void>;
}

export const sideConversationRendererServiceCapability: CapabilityToken<SideConversationRendererService> = defineCapability({
  id: 'side-conversation.renderer-service',
  description: 'Renderer lifecycle service for transient side conversation snapshots',
});

export function createNoopSideConversationRendererService(): SideConversationRendererService {
  return Object.freeze({
    available: false,
    create: async () => {
      throw new FeatureOperationFailure({
        code: 'FEATURE_UNAVAILABLE',
        message: 'Side Conversation Feature is unavailable.',
        retryable: true,
      });
    },
    discard: async () => undefined,
  });
}
