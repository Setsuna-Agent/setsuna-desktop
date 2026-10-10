import {
  cloneRuntimeSkillReferences,
  cloneRuntimeThreadGoal,
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  normalizeRuntimeMessageProviderMetadata,
  type RuntimeMessage,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { managedGeneratedImageAssetIds } from '../../utils/generated-image-assets.js';
import type { RuntimeContainer } from '../runtime-factory.js';
import { randomRuntimeId } from '../runtime-id.js';
import { runtimeMessageCopyEvents } from './thread-fork-history.js';
import { relocateForkFileChanges, type ForkFileChangeRelocation } from './thread-fork-file-changes.js';

/**
 * Copies an immutable message snapshot into a new thread while giving generated
 * image assets independent ownership. Callers own attachment retention and
 * rollback cleanup for the destination thread and its retained results.
 * Only conversation forks opt into historical visibility; side snapshots keep
 * their supplied visibility and must not compact away destination messages.
 */
export async function copyRuntimeMessagesToThread(
  runtime: RuntimeContainer,
  sourceThreadId: string,
  destinationThreadId: string,
  messages: RuntimeMessage[],
  options: { preserveForkHistory?: boolean; fileChangeRelocation?: ForkFileChangeRelocation } = {},
): Promise<void> {
  const events = options.preserveForkHistory && messages.some((message) => message.contextCompaction)
    ? await runtime.threadStore.listEvents(sourceThreadId) : [];
  const history = runtimeMessageCopyEvents(events, messages);
  const cloned = await cloneForkMessages(runtime, history.flatMap((event) => (
    event.type === 'message.created' ? [event.payload.message] : event.payload.messages
  )), options.fileChangeRelocation);
  const committedAssetIds = new Set<string>();
  let appendAttempted = false;
  try {
    const resultIds = [...new Set(cloned.messages.flatMap((message) =>
      message.toolResultRef ? [message.toolResultRef.resultId] : []))];
    if (resultIds.length) {
      // Retain before appending so quota eviction cannot race the copied messages.
      // Unavailable results are an expected degraded state: the bounded message
      // content remains useful, but the child must not inherit a dangling reference.
      const retention = await runtime.toolResultStore.retainForThread({
        sourceThreadId,
        destinationThreadId,
        resultIds,
      });
      const retainedResultIds = new Set(retention.retainedResultIds);
      for (const message of cloned.messages) {
        if (message.toolResultRef && !retainedResultIds.has(message.toolResultRef.resultId)) {
          delete message.toolResultRef;
        }
      }
    }
    await runtime.eventWriter.flushThread(destinationThreadId);
    let messageIndex = 0;
    for (const event of history) {
      const count = event.type === 'message.created' ? 1 : event.payload.messages.length;
      const eventMessages = cloned.messages.slice(messageIndex, messageIndex + count);
      messageIndex += count;
      const copiedEvent = event.type === 'message.created'
        ? { type: event.type, payload: { message: eventMessages[0]! } }
        : { type: event.type, payload: { notice: event.payload.notice, messages: eventMessages } };
      appendAttempted = true;
      await runtime.threadStore.appendEvent(destinationThreadId, {
        id: randomRuntimeId('event_fork'),
        threadId: destinationThreadId,
        turnId: event.turnId,
        createdAt: new Date().toISOString(),
        ...copiedEvent,
      });
      for (const attachment of eventMessages.flatMap((message) => message.attachments ?? [])) {
        if (isRuntimeGeneratedMessageAttachment(attachment)) committedAssetIds.add(attachment.assetId);
      }
    }
  } catch (error) {
    if (appendAttempted) {
      try {
        const snapshot = await runtime.threadStore.getThread(destinationThreadId);
        for (const assetId of managedGeneratedImageAssetIds(snapshot)) committedAssetIds.add(assetId);
      } catch {
        // The append may already be durable. Keep every uncertain clone so
        // destination deletion or startup recovery can clean it safely.
        throw error;
      }
    }
    const uncommittedAssetIds = cloned.assetIds.filter((assetId) => !committedAssetIds.has(assetId));
    await Promise.allSettled(uncommittedAssetIds.map((assetId) => runtime.generatedImageStore.delete(assetId)));
    throw error;
  }
}

async function cloneForkMessages(
  runtime: RuntimeContainer,
  messages: RuntimeMessage[],
  fileChangeRelocation?: ForkFileChangeRelocation,
): Promise<{ assetIds: string[]; messages: RuntimeMessage[] }> {
  const clonedAssetIds: string[] = [];
  const clonesBySourceId = new Map<string, string>();
  try {
    const clonedMessages: RuntimeMessage[] = [];
    for (const message of messages) {
      const clonedMessage = cloneRuntimeMessage(message, fileChangeRelocation);
      const attachments: RuntimeMessageAttachment[] = [];
      for (const attachment of clonedMessage.attachments ?? []) {
        if (isRuntimeGeneratedMessageAttachment(attachment)) {
          let clonedAssetId = clonesBySourceId.get(attachment.assetId);
          if (!clonedAssetId) {
            const clonedAsset = await runtime.generatedImageStore.clone(attachment.assetId);
            clonedAssetId = clonedAsset.assetId;
            clonesBySourceId.set(attachment.assetId, clonedAssetId);
            clonedAssetIds.push(clonedAssetId);
          }
          attachments.push({ ...attachment, assetId: clonedAssetId });
        } else if (isRuntimeInlineMessageAttachment(attachment) && attachment.localAssetId) {
          // Legacy inline images retain their Data URL; the child recreates its local cache lazily.
          const inlineAttachment = { ...attachment };
          delete inlineAttachment.localAssetId;
          attachments.push(inlineAttachment);
        } else {
          attachments.push(attachment);
        }
      }
      clonedMessages.push({ ...clonedMessage, attachments });
    }
    return { assetIds: clonedAssetIds, messages: clonedMessages };
  } catch (error) {
    await Promise.allSettled(clonedAssetIds.map((assetId) => runtime.generatedImageStore.delete(assetId)));
    throw error;
  }
}

function cloneRuntimeMessage(message: RuntimeMessage, fileChangeRelocation?: ForkFileChangeRelocation): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    toolResultRef: message.toolResultRef ? { ...message.toolResultRef } : undefined,
    streamParts: message.streamParts?.map((part) => ({ ...part })),
    skillReferences: cloneRuntimeSkillReferences(message.skillReferences),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    goalMode: message.goalMode ? {
      ...message.goalMode,
      goal: cloneRuntimeThreadGoal(message.goalMode.goal),
    } : undefined,
    planMode: message.planMode ? { ...message.planMode } : undefined,
    providerMetadata: message.providerMetadata
      ? normalizeRuntimeMessageProviderMetadata(message.providerMetadata)
      : undefined,
    reviewMode: message.reviewMode ? {
      ...message.reviewMode,
      findings: message.reviewMode.findings?.map((finding) => ({ ...finding })),
    } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun,
      ...(fileChangeRelocation ? { data: relocateForkFileChanges(toolRun.data, fileChangeRelocation) } : {}),
    })),
  };
}
