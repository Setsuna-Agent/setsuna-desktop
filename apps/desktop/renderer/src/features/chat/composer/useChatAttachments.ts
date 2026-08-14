import {
  isRuntimeInlineMessageAttachment,
  isRuntimeStoredMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatImageAttachmentOutcome } from '../../../app/types.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  createChatMessageAttachment,
  isChatPreviewableImageType,
  maxChatAttachments,
  type ChatComposerAttachmentItem,
} from './chatAttachments.js';
import {
  rejectedChatImageAttachment,
  uploadInlineChatImageAttachment,
} from './chatImageAttachments.js';

const attachmentExitAnimationMs = 180;

export function disposableChatAttachments(
  items: ChatComposerAttachmentItem[],
  inFlightAttachmentIds: ReadonlySet<string>,
): RuntimeMessageAttachment[] {
  return items
    .map((item) => item.attachment)
    .filter((attachment): attachment is RuntimeMessageAttachment => (
      attachment !== undefined && !inFlightAttachmentIds.has(attachment.id)
    ));
}

export function inlineImageAttachmentsToStore(
  items: ChatComposerAttachmentItem[],
): Array<{ item: ChatComposerAttachmentItem; attachment: RuntimeInlineMessageAttachment }> {
  return items.flatMap((item) => (
    item.attachment
      && isRuntimeInlineMessageAttachment(item.attachment)
      && item.attachment.type.startsWith('image/')
      ? [{ item, attachment: item.attachment }]
      : []
  ));
}

export function useChatAttachments({ client }: {
  client: Pick<DesktopRuntimeClient, 'deleteAttachment' | 'linkAttachment' | 'uploadAttachment'>;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<ChatComposerAttachmentItem[]>([]);
  const itemsRef = useRef<ChatComposerAttachmentItem[]>([]);
  const cancelledKeysRef = useRef(new Set<string>());
  const inFlightAttachmentIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
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
    const pending = selected.map((file): ChatComposerAttachmentItem => ({
      key: attachmentKey(),
      name: file.name || 'attachment',
      type: file.type || 'application/octet-stream',
      size: file.size,
      status: 'preparing',
      ...(isChatPreviewableImageType(file.type) ? { previewUrl: createImagePreviewUrl(file) } : {}),
    }));
    commitItems([...itemsRef.current, ...pending]);

    await Promise.all(pending.map(async (item, index) => {
      try {
        const attachment = await createChatMessageAttachment(selected[index], client, t);
        if (cancelledKeysRef.current.has(item.key)) {
          discardStoredAttachment(attachment);
          return;
        }
        replaceItem(item.key, {
          ...item,
          attachment,
          name: attachment.name,
          size: attachment.size,
          type: attachment.type,
          status: 'ready',
        });
      } catch (error) {
        if (cancelledKeysRef.current.has(item.key)) return;
        replaceItem(item.key, {
          ...item,
          status: 'error',
          error: error instanceof Error ? error.message : t('chat.composer.attachmentAddFailed'),
        });
      } finally {
        cancelledKeysRef.current.delete(item.key);
      }
    }));
  }, [client, commitItems, discardStoredAttachment, replaceItem, t]);

  const storeInlineImage = useCallback((
    item: ChatComposerAttachmentItem,
    attachment: RuntimeInlineMessageAttachment,
  ) => {
    const previewUrl = item.previewUrl ?? attachment.url;
    replaceItem(item.key, { ...item, attachment, previewUrl, status: 'preparing' });
    void uploadInlineChatImageAttachment(attachment, client)
      .then((storedAttachment) => {
        if (cancelledKeysRef.current.has(item.key)) {
          discardStoredAttachment(storedAttachment);
          return;
        }
        replaceItem(item.key, { ...item, attachment: storedAttachment, previewUrl, status: 'ready' });
      })
      .catch((error: unknown) => {
        if (cancelledKeysRef.current.has(item.key)) return;
        replaceItem(item.key, {
          ...item,
          attachment,
          previewUrl,
          status: 'error',
          error: error instanceof Error ? error.message : t('chat.composer.attachmentAddFailed'),
        });
      })
      .finally(() => {
        cancelledKeysRef.current.delete(item.key);
      });
  }, [client, discardStoredAttachment, replaceItem, t]);

  const addExistingImage = useCallback((attachment: RuntimeMessageAttachment): ChatImageAttachmentOutcome => {
    const currentCount = itemsRef.current.filter((item) => item.status !== 'removing').length;
    const rejection = rejectedChatImageAttachment(attachment, currentCount);
    if (rejection) return rejection;
    if (!isRuntimeInlineMessageAttachment(attachment)) return 'unavailable';
    if (itemsRef.current.some((item) => item.attachment?.id === attachment.id)) return 'added';
    const item: ChatComposerAttachmentItem = {
      key: attachmentKey(),
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      status: 'ready',
      attachment,
      previewUrl: attachment.url,
    };
    commitItems([...itemsRef.current, item]);
    storeInlineImage(item, attachment);
    return 'added';
  }, [commitItems, storeInlineImage]);

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (!item || item.status === 'removing') return;
    if (item.status === 'preparing') cancelledKeysRef.current.add(key);
    replaceItem(key, { ...item, status: 'removing' });
    const timer = window.setTimeout(() => {
      removalTimersRef.current.delete(key);
      const removed = itemsRef.current.find((candidate) => candidate.key === key);
      commitItems(itemsRef.current.filter((candidate) => candidate.key !== key));
      discardStoredAttachment(removed?.attachment);
      releaseImagePreviewUrl(removed?.previewUrl);
    }, attachmentExitAnimationMs);
    removalTimersRef.current.set(key, timer);
  }, [commitItems, discardStoredAttachment, replaceItem]);

  const clear = useCallback(() => {
    const currentItems = itemsRef.current;
    for (const item of currentItems) {
      if (item.status === 'preparing') cancelledKeysRef.current.add(item.key);
    }
    for (const timer of removalTimersRef.current.values()) window.clearTimeout(timer);
    removalTimersRef.current.clear();
    commitItems([]);
    for (const item of currentItems) releaseImagePreviewUrl(item.previewUrl);

    // 已归属线程的队列附件不会被 deletePending 删除；编辑期间新登记但未提交的
    // 本地引用或托管图片则会在取消或失败时被可靠回收。
    const disposable = disposableChatAttachments(currentItems, inFlightAttachmentIdsRef.current);
    for (const attachment of disposable) discardStoredAttachment(attachment);
  }, [commitItems, discardStoredAttachment]);

  const replaceWithExisting = useCallback((attachments: RuntimeMessageAttachment[]) => {
    clear();
    const uniqueAttachments = [...new Map(
      attachments.map((attachment) => [attachment.id, attachment] as const),
    ).values()];
    const nextItems = uniqueAttachments.map((attachment): ChatComposerAttachmentItem => ({
      key: attachmentKey(),
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      status: 'ready',
      attachment: { ...attachment },
      ...(isRuntimeInlineMessageAttachment(attachment) && isChatPreviewableImageType(attachment.type)
        ? { previewUrl: attachment.url }
        : {}),
    }));
    commitItems(nextItems);
    // Queued inputs can contain legacy inline images. Normalize them immediately instead
    // of relying on a capability effect that has already run before the edit is loaded.
    for (const { item, attachment } of inlineImageAttachmentsToStore(nextItems)) {
      storeInlineImage(item, attachment);
    }
  }, [clear, commitItems, storeInlineImage]);

  const clearAfterSend = useCallback((sentAttachments: RuntimeMessageAttachment[]) => {
    const sentIds = new Set(sentAttachments.map((attachment) => attachment.id));
    if (!sentIds.size) return;
    // 保留请求进行期间新增的附件项或错误，只移除已经接收的快照。
    const sentItems = itemsRef.current.filter((item) => item.attachment && sentIds.has(item.attachment.id));
    commitItems(itemsRef.current.filter((item) => !item.attachment || !sentIds.has(item.attachment.id)));
    for (const item of sentItems) releaseImagePreviewUrl(item.previewUrl);
  }, [commitItems]);

  const beginSend = useCallback((sentAttachments: RuntimeMessageAttachment[]) => {
    for (const attachment of sentAttachments) inFlightAttachmentIdsRef.current.add(attachment.id);
  }, []);

  const settleSend = useCallback((sentAttachments: RuntimeMessageAttachment[], sent: boolean) => {
    for (const attachment of sentAttachments) inFlightAttachmentIdsRef.current.delete(attachment.id);
    if (sent) {
      if (mountedRef.current) clearAfterSend(sentAttachments);
      return;
    }
    // If navigation already disposed this composer, a rejected send has no UI that
    // can retry the attachments. Release its stored assets now instead of leaking them.
    if (!mountedRef.current) {
      for (const attachment of sentAttachments) discardStoredAttachment(attachment);
    }
  }, [clearAfterSend, discardStoredAttachment]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of removalTimersRef.current.values()) window.clearTimeout(timer);
      const disposableAttachments = disposableChatAttachments(itemsRef.current, inFlightAttachmentIdsRef.current);
      for (const item of itemsRef.current) {
        cancelledKeysRef.current.add(item.key);
      }
      for (const attachment of disposableAttachments) discardStoredAttachment(attachment);
      for (const item of itemsRef.current) releaseImagePreviewUrl(item.previewUrl);
      removalTimersRef.current.clear();
    };
  }, [discardStoredAttachment]);

  const sendableAttachments = items
    .filter((item) => item.status === 'ready' && item.attachment)
    .map((item) => item.attachment as RuntimeMessageAttachment);

  return {
    addExistingImage,
    addFiles,
    atLimit: items.filter((item) => item.status !== 'removing').length >= maxChatAttachments,
    beginSend,
    busy: items.some((item) => item.status === 'preparing'),
    clear,
    items,
    remove,
    replaceWithExisting,
    sendableAttachments,
    settleSend,
  };
}

function attachmentKey(): string {
  return `composer_attachment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function createImagePreviewUrl(file: File): string | undefined {
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}

function releaseImagePreviewUrl(url: string | undefined): void {
  if (!url?.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
}
