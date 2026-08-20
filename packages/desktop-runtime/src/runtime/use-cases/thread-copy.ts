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

/**
 * Copies an immutable message snapshot into a new thread while giving generated
 * image assets independent ownership. Callers own attachment retention and
 * deletion rollback for the destination thread.
 */
export async function copyRuntimeMessagesToThread(
  runtime: RuntimeContainer,
  threadId: string,
  messages: RuntimeMessage[],
): Promise<void> {
  const cloned = await cloneForkMessages(runtime, messages);
  const committedAssetIds = new Set<string>();
  let appendAttempted = false;
  try {
    await runtime.eventWriter.flushThread(threadId);
    let index = 0;
    for (const message of cloned.messages) {
      index += 1;
      appendAttempted = true;
      await runtime.threadStore.appendEvent(threadId, {
        id: `event_fork_${message.id}_${index}`,
        threadId,
        turnId: message.turnId,
        type: 'message.created',
        createdAt: new Date().toISOString(),
        payload: { message },
      });
      for (const attachment of message.attachments ?? []) {
        if (isRuntimeGeneratedMessageAttachment(attachment)) committedAssetIds.add(attachment.assetId);
      }
    }
  } catch (error) {
    if (appendAttempted) {
      try {
        const snapshot = await runtime.threadStore.getThread(threadId);
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
  // 消息与结果授权必须一起成功；调用方会在失败时删除尚未完成的 fork/side thread。
  // 吞掉 retain 错误会留下一个永久无法 read_tool_result 的悬空引用。
  const resultIds = cloned.messages.flatMap((message) =>
    message.toolResultRef ? [message.toolResultRef.resultId] : []);
  if (resultIds.length) {
    await runtime.toolResultStore.retainForThread(threadId, resultIds);
  }
}

async function cloneForkMessages(
  runtime: RuntimeContainer,
  messages: RuntimeMessage[],
): Promise<{ assetIds: string[]; messages: RuntimeMessage[] }> {
  const clonedAssetIds: string[] = [];
  const clonesBySourceId = new Map<string, string>();
  try {
    const clonedMessages: RuntimeMessage[] = [];
    for (const message of messages) {
      const clonedMessage = cloneRuntimeMessage(message);
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

function cloneRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
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
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}
