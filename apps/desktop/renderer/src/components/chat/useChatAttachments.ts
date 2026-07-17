import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isRuntimeStoredMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { ChatImageAttachmentOutcome } from '../../types/app.js';
import { rejectedChatImageAttachment } from './chatImageAttachments.js';
import {
  chatAttachmentValidationError,
  createChatMessageAttachment,
  isImageMessageAttachment,
  maxChatAttachments,
  type ChatComposerAttachmentItem,
} from './chatAttachments.js';

const attachmentExitAnimationMs = 180;

export function useChatAttachments({
  client,
  supportsImageInput,
}: {
  client: Pick<DesktopRuntimeClient, 'deleteAttachment' | 'uploadAttachment'>;
  supportsImageInput: boolean;
}) {
  const [items, setItems] = useState<ChatComposerAttachmentItem[]>([]);
  const itemsRef = useRef<ChatComposerAttachmentItem[]>([]);
  const cancelledKeysRef = useRef(new Set<string>());
  const removalTimersRef = useRef(new Map<string, number>());

  const commitItems = useCallback((next: ChatComposerAttachmentItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const replaceItem = useCallback((key: string, replacement: ChatComposerAttachmentItem) => {
    commitItems(itemsRef.current.map((item) => item.key === key ? replacement : item));
  }, [commitItems]);

  const discardStoredAttachment = useCallback((attachment: RuntimeMessageAttachment | undefined) => {
    if (!attachment || !isRuntimeStoredMessageAttachment(attachment)) return;
    void client.deleteAttachment(attachment.assetId).catch(() => undefined);
  }, [client]);

  const addFiles = useCallback(async (files: File[]) => {
    const available = maxChatAttachments - itemsRef.current.filter((item) => item.status !== 'removing').length;
    if (available <= 0) return;
    const selected = files.slice(0, available);
    const pending = selected.map((file): ChatComposerAttachmentItem => {
      const error = chatAttachmentValidationError(file, supportsImageInput);
      return {
        key: attachmentKey(),
        name: file.name || 'attachment',
        type: file.type || 'application/octet-stream',
        size: file.size,
        status: error ? 'error' : 'uploading',
        ...(error ? { error } : {}),
      };
    });
    commitItems([...itemsRef.current, ...pending]);

    await Promise.all(pending.map(async (item, index) => {
      if (item.status === 'error') return;
      try {
        const attachment = await createChatMessageAttachment(selected[index], client);
        if (cancelledKeysRef.current.has(item.key)) {
          discardStoredAttachment(attachment);
          return;
        }
        replaceItem(item.key, { ...item, attachment, status: 'ready' });
      } catch (error) {
        if (cancelledKeysRef.current.has(item.key)) return;
        replaceItem(item.key, {
          ...item,
          status: 'error',
          error: error instanceof Error ? error.message : '附件上传失败',
        });
      } finally {
        cancelledKeysRef.current.delete(item.key);
      }
    }));
  }, [client, commitItems, discardStoredAttachment, replaceItem, supportsImageInput]);

  const addExistingImage = useCallback((attachment: RuntimeMessageAttachment): ChatImageAttachmentOutcome => {
    const currentCount = itemsRef.current.filter((item) => item.status !== 'removing').length;
    const rejection = rejectedChatImageAttachment(attachment, currentCount, supportsImageInput);
    if (rejection) return rejection;
    if (itemsRef.current.some((item) => item.attachment?.id === attachment.id)) return 'added';
    commitItems([...itemsRef.current, {
      key: attachmentKey(),
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      status: 'ready',
      attachment,
    }]);
    return 'added';
  }, [commitItems, supportsImageInput]);

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (!item || item.status === 'removing') return;
    if (item.status === 'uploading') cancelledKeysRef.current.add(key);
    replaceItem(key, { ...item, status: 'removing' });
    const timer = window.setTimeout(() => {
      removalTimersRef.current.delete(key);
      const removed = itemsRef.current.find((candidate) => candidate.key === key);
      commitItems(itemsRef.current.filter((candidate) => candidate.key !== key));
      discardStoredAttachment(removed?.attachment);
    }, attachmentExitAnimationMs);
    removalTimersRef.current.set(key, timer);
  }, [commitItems, discardStoredAttachment, replaceItem]);

  const clearAfterSend = useCallback((sentAttachments: RuntimeMessageAttachment[]) => {
    const sentIds = new Set(sentAttachments.map((attachment) => attachment.id));
    if (!sentIds.size) return;
    // Keep uploads/errors that arrived while the request was in flight; remove only the accepted snapshot.
    commitItems(itemsRef.current.filter((item) => !item.attachment || !sentIds.has(item.attachment.id)));
  }, [commitItems]);

  useEffect(() => {
    if (supportsImageInput) return;
    const removed = itemsRef.current.filter((item) => item.attachment && isImageMessageAttachment(item.attachment));
    if (!removed.length) return;
    commitItems(itemsRef.current.filter((item) => !removed.includes(item)));
  }, [commitItems, supportsImageInput]);

  useEffect(() => () => {
    for (const timer of removalTimersRef.current.values()) window.clearTimeout(timer);
    for (const item of itemsRef.current) {
      cancelledKeysRef.current.add(item.key);
      discardStoredAttachment(item.attachment);
    }
    removalTimersRef.current.clear();
  }, [discardStoredAttachment]);

  const sendableAttachments = items
    .filter((item) => item.status === 'ready' && item.attachment)
    .map((item) => item.attachment as RuntimeMessageAttachment);

  return {
    addExistingImage,
    addFiles,
    atLimit: items.filter((item) => item.status !== 'removing').length >= maxChatAttachments,
    busy: items.some((item) => item.status === 'uploading'),
    clearAfterSend,
    items,
    remove,
    sendableAttachments,
  };
}

function attachmentKey(): string {
  return `composer_attachment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
