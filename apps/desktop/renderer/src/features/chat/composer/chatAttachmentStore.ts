import {
  isRuntimeInlineMessageAttachment,
  isRuntimeStoredMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { ChatImageAttachmentOutcome } from '../../../app/types.js';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
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

export type ChatAttachmentClient = Pick<DesktopRuntimeClient, 'deleteAttachment' | 'linkAttachment' | 'uploadAttachment'>;
export type ChatAttachmentStore = ReturnType<typeof createChatAttachmentStore>;

/** Owns pending uploads and assets independently of the currently mounted editor. */
export function createChatAttachmentStore(client: ChatAttachmentClient, t: Translate) {
  let items: ChatComposerAttachmentItem[] = [];
  let sending = false;
  let snapshot = { items, sending };
  const listeners = new Set<() => void>();
  const cancelledKeys = new Set<string>();
  const inFlightAttachmentIds = new Set<string>();
  const removalTimers = new Map<string, number>();

  const commitItems = (next: ChatComposerAttachmentItem[]) => {
    items = next;
    snapshot = { items, sending };
    for (const listener of listeners) listener();
  };

  const replaceItem = (key: string, replacement: ChatComposerAttachmentItem) => {
    commitItems(items.map((item) => item.key === key ? replacement : item));
  };

  const discardStoredAttachment = (attachment: RuntimeMessageAttachment | undefined) => {
    if (!attachment || !isRuntimeStoredMessageAttachment(attachment)) return;
    void client.deleteAttachment(attachment.assetId).catch(() => undefined);
  };

  const addFiles = async (files: File[]) => {
    const available = maxChatAttachments - items.filter((item) => item.status !== 'removing').length;
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
    commitItems([...items, ...pending]);

    await Promise.all(pending.map(async (item, index) => {
      try {
        const attachment = await createChatMessageAttachment(selected[index], client, t);
        if (cancelledKeys.has(item.key)) {
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
        if (cancelledKeys.has(item.key)) return;
        replaceItem(item.key, {
          ...item,
          status: 'error',
          error: error instanceof Error ? error.message : t('chat.composer.attachmentAddFailed'),
        });
      } finally {
        cancelledKeys.delete(item.key);
      }
    }));
  };

  const storeInlineImage = (
    item: ChatComposerAttachmentItem,
    attachment: RuntimeInlineMessageAttachment,
  ) => {
    const previewUrl = item.previewUrl ?? attachment.url;
    replaceItem(item.key, { ...item, attachment, previewUrl, status: 'preparing' });
    void uploadInlineChatImageAttachment(attachment, client)
      .then((storedAttachment) => {
        if (cancelledKeys.has(item.key)) {
          discardStoredAttachment(storedAttachment);
          return;
        }
        replaceItem(item.key, { ...item, attachment: storedAttachment, previewUrl, status: 'ready' });
      })
      .catch((error: unknown) => {
        if (cancelledKeys.has(item.key)) return;
        replaceItem(item.key, {
          ...item,
          attachment,
          previewUrl,
          status: 'error',
          error: error instanceof Error ? error.message : t('chat.composer.attachmentAddFailed'),
        });
      })
      .finally(() => {
        cancelledKeys.delete(item.key);
      });
  };

  const addExistingImage = (attachment: RuntimeMessageAttachment): ChatImageAttachmentOutcome => {
    const currentCount = items.filter((item) => item.status !== 'removing').length;
    const rejection = rejectedChatImageAttachment(attachment, currentCount);
    if (rejection) return rejection;
    if (!isRuntimeInlineMessageAttachment(attachment)) return 'unavailable';
    if (items.some((item) => item.attachment?.id === attachment.id)) return 'added';
    const item: ChatComposerAttachmentItem = {
      key: attachmentKey(),
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      status: 'ready',
      attachment,
      previewUrl: attachment.url,
    };
    commitItems([...items, item]);
    storeInlineImage(item, attachment);
    return 'added';
  };

  const remove = (key: string) => {
    const item = items.find((candidate) => candidate.key === key);
    if (!item || item.status === 'removing') return;
    if (item.status === 'preparing') cancelledKeys.add(key);
    replaceItem(key, { ...item, status: 'removing' });
    const timer = window.setTimeout(() => {
      removalTimers.delete(key);
      const removed = items.find((candidate) => candidate.key === key);
      commitItems(items.filter((candidate) => candidate.key !== key));
      discardStoredAttachment(removed?.attachment);
      releaseImagePreviewUrl(removed?.previewUrl);
    }, attachmentExitAnimationMs);
    removalTimers.set(key, timer);
  };

  const clear = () => {
    const currentItems = items;
    for (const item of currentItems) {
      if (item.status === 'preparing') cancelledKeys.add(item.key);
    }
    for (const timer of removalTimers.values()) window.clearTimeout(timer);
    removalTimers.clear();
    commitItems([]);
    for (const item of currentItems) releaseImagePreviewUrl(item.previewUrl);

    // 已归属线程的队列附件不会被 deletePending 删除；编辑期间新登记但未提交的
    // 本地引用或托管图片则会在取消或失败时被可靠回收。
    const disposable = disposableChatAttachments(currentItems, inFlightAttachmentIds);
    for (const attachment of disposable) discardStoredAttachment(attachment);
  };

  const replaceWithExisting = (attachments: RuntimeMessageAttachment[]) => {
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
  };

  const clearAfterSend = (sentAttachments: RuntimeMessageAttachment[]) => {
    const sentIds = new Set(sentAttachments.map((attachment) => attachment.id));
    if (!sentIds.size) return;
    // 保留请求进行期间新增的附件项或错误，只移除已经接收的快照。
    const sentItems = items.filter((item) => item.attachment && sentIds.has(item.attachment.id));
    commitItems(items.filter((item) => !item.attachment || !sentIds.has(item.attachment.id)));
    for (const item of sentItems) releaseImagePreviewUrl(item.previewUrl);
  };

  const beginSend = (sentAttachments: RuntimeMessageAttachment[]) => {
    // Text-only sends also retain their lock when navigation remounts the editor.
    sending = true;
    for (const attachment of sentAttachments) inFlightAttachmentIds.add(attachment.id);
    commitItems(items);
  };

  const settleSend = (sentAttachments: RuntimeMessageAttachment[], sent: boolean) => {
    sending = false;
    for (const attachment of sentAttachments) inFlightAttachmentIds.delete(attachment.id);
    if (sent) clearAfterSend(sentAttachments);
    else {
      // A retained draft can retry a failed send; only explicitly discarded drafts
      // release assets whose send lease has just ended.
      for (const attachment of sentAttachments) {
        if (!items.some((item) => item.attachment?.id === attachment.id)) discardStoredAttachment(attachment);
      }
    }
    commitItems(items);
  };

  return {
    addExistingImage,
    addFiles,
    beginSend,
    clear,
    dispose: clear,
    getSnapshot: () => snapshot,
    remove,
    replaceWithExisting,
    settleSend,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
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
