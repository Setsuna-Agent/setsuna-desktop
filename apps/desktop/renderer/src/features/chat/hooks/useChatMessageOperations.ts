import type { MessagePatch, RuntimeMessage } from '@setsuna-desktop/contracts';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { ChatDisplayItem } from '../conversation/chatMessageDisplay.js';
import { commitChatWorkspaceOperation } from '../conversation/chatWorkspaceOperationScope.js';

type ChatMessageOperationsOptions = {
  activeTurnId: string | null;
  composerKey: string;
  currentThreadId?: string;
  displayItems: ChatDisplayItem[];
  onDeleteMessages?: (messageIds: string[]) => void | Promise<void>;
  onEditUserMessage?: (messageId: string, input: MessagePatch) => void | Promise<void>;
  readOnly?: boolean;
};

export function useChatMessageOperations({
  activeTurnId,
  composerKey,
  currentThreadId,
  displayItems,
  onDeleteMessages,
  onEditUserMessage,
  readOnly = false,
}: ChatMessageOperationsOptions) {
  const { t } = useI18n();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [selectedDeleteItemIds, setSelectedDeleteItemIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const operationRequests = useIdentityRequestGuard(`${composerKey}:${currentThreadId ?? ''}:${readOnly}`);

  useLayoutEffect(() => {
    setEditingMessageId(null);
    setEditingSubmitting(false);
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setActionError(null);
  }, [composerKey, currentThreadId, readOnly]);

  const selectableDeleteItems = useMemo(
    () => displayItems
      .filter((item): item is Extract<ChatDisplayItem, { type: 'user' | 'assistant' }> => (
        item.type === 'user' || item.type === 'assistant'
      ))
      .map((item) => ({
        id: item.id,
        messageIds: item.messageIds,
        type: item.type,
      })),
    [displayItems],
  );
  const selectedDeleteMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selectableDeleteItems) {
      if (!selectedDeleteItemIds.has(item.id)) continue;
      item.messageIds.forEach((id) => ids.add(id));
    }
    return [...ids];
  }, [selectableDeleteItems, selectedDeleteItemIds]);
  const selectedDeleteCount = selectedDeleteItemIds.size;
  const allDeleteSelected = selectableDeleteItems.length > 0
    && selectedDeleteCount === selectableDeleteItems.length;
  const someDeleteSelected = selectedDeleteCount > 0
    && selectedDeleteCount < selectableDeleteItems.length;

  useLayoutEffect(() => {
    const validIds = new Set(selectableDeleteItems.map((item) => item.id));
    setSelectedDeleteItemIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [selectableDeleteItems]);

  const deleteGroupItemIds = useCallback((itemId: string) => {
    const index = selectableDeleteItems.findIndex((item) => item.id === itemId);
    if (index < 0) return [itemId];
    const item = selectableDeleteItems[index];
    const ids = [item.id];
    // Keep question/answer turns together so deleting one side does not orphan the other.
    if (item.type === 'assistant') {
      const previousUser = [...selectableDeleteItems.slice(0, index)]
        .reverse()
        .find((candidate) => candidate.type === 'user');
      if (previousUser) ids.push(previousUser.id);
    }
    if (item.type === 'user') {
      const nextItem = selectableDeleteItems[index + 1];
      if (nextItem?.type === 'assistant') ids.push(nextItem.id);
    }
    return ids;
  }, [selectableDeleteItems]);

  const startDeleteSelection = useCallback((itemId: string) => {
    if (readOnly || activeTurnId) return;
    setActionError(null);
    setEditingMessageId(null);
    setEditingSubmitting(false);
    setDeleteMode(true);
    setSelectedDeleteItemIds(new Set(deleteGroupItemIds(itemId)));
  }, [activeTurnId, deleteGroupItemIds, readOnly]);

  const toggleDeleteSelection = useCallback((itemId: string, checked: boolean) => {
    if (readOnly) return;
    const groupIds = deleteGroupItemIds(itemId);
    setSelectedDeleteItemIds((current) => {
      const next = new Set(current);
      groupIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, [deleteGroupItemIds, readOnly]);

  const toggleAllDeleteSelection = useCallback((checked: boolean) => {
    if (readOnly) return;
    setSelectedDeleteItemIds(checked
      ? new Set(selectableDeleteItems.map((item) => item.id))
      : new Set());
  }, [readOnly, selectableDeleteItems]);

  const cancelDeleteSelection = useCallback(() => {
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setActionError(null);
  }, []);

  const confirmDeleteSelection = useCallback(async () => {
    if (readOnly || !onDeleteMessages) return;
    const isCurrentOperation = operationRequests.begin();
    if (!selectedDeleteMessageIds.length) {
      setActionError(t('chat.delete.selectFirst'));
      return;
    }
    setDeletingMessages(true);
    setActionError(null);
    try {
      // Runtime deletion operates on message ids; one display item can own several messages.
      await onDeleteMessages(selectedDeleteMessageIds);
      commitChatWorkspaceOperation(isCurrentOperation, cancelDeleteSelection);
    } catch (unknownError) {
      commitChatWorkspaceOperation(isCurrentOperation, () => {
        setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    } finally {
      commitChatWorkspaceOperation(isCurrentOperation, () => setDeletingMessages(false));
    }
  }, [cancelDeleteSelection, onDeleteMessages, operationRequests, readOnly, selectedDeleteMessageIds, t]);

  const startEditingMessage = useCallback((message: RuntimeMessage) => {
    if (readOnly || activeTurnId || editingSubmitting) return;
    operationRequests.invalidate();
    setActionError(null);
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setEditingMessageId(message.id);
  }, [activeTurnId, editingSubmitting, operationRequests, readOnly]);

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setActionError(null);
  }, []);

  const submitEditingMessage = useCallback(async (messageId: string, input: MessagePatch): Promise<boolean> => {
    if (readOnly || activeTurnId || !onEditUserMessage || editingSubmitting || messageId !== editingMessageId) return false;
    const content = input.content.trim();
    if (!content && !input.attachments?.length) return false;
    const isCurrentOperation = operationRequests.begin();
    setEditingSubmitting(true);
    setActionError(null);
    try {
      await onEditUserMessage(messageId, { ...input, content });
      commitChatWorkspaceOperation(isCurrentOperation, cancelEditingMessage);
      return true;
    } catch (unknownError) {
      commitChatWorkspaceOperation(isCurrentOperation, () => {
        setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
      return false;
    } finally {
      commitChatWorkspaceOperation(isCurrentOperation, () => setEditingSubmitting(false));
    }
  }, [activeTurnId, cancelEditingMessage, editingMessageId, editingSubmitting, onEditUserMessage, operationRequests, readOnly]);

  return {
    actionError,
    allDeleteSelected,
    cancelDeleteSelection,
    cancelEditingMessage,
    confirmDeleteSelection,
    deleteMode,
    deletingMessages,
    editingMessageId,
    editingSubmitting,
    selectedDeleteCount,
    selectableDeleteCount: selectableDeleteItems.length,
    selectedDeleteItemIds,
    selectedDeleteMessageIds,
    someDeleteSelected,
    startDeleteSelection,
    startEditingMessage,
    submitEditingMessage,
    toggleAllDeleteSelection,
    toggleDeleteSelection,
  };
}
