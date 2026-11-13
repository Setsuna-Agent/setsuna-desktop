import type { DesktopConversationExportFormat, MessagePatch, RuntimeMessage } from '@setsuna-desktop/contracts';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import type { ChatDisplayItem } from '../conversation/chatMessageDisplay.js';
import { useChatMessageSelection } from './useChatMessageSelection.js';
import { commitChatWorkspaceOperation } from '../conversation/chatWorkspaceOperationScope.js';

type ChatMessageOperationsOptions = {
  activeTurnId: string | null;
  composerKey: string;
  currentThreadId?: string;
  displayItems: ChatDisplayItem[];
  onDeleteMessages?: (messageIds: string[]) => void | Promise<void>;
  onExportMessages?: (messageIds: string[], format: DesktopConversationExportFormat) => Promise<{ cancelled?: boolean }>;
  onEditUserMessage?: (messageId: string, input: MessagePatch) => void | Promise<void>;
  readOnly?: boolean;
};

export function useChatMessageOperations({
  activeTurnId,
  composerKey,
  currentThreadId,
  displayItems,
  onDeleteMessages,
  onExportMessages,
  onEditUserMessage,
  readOnly = false,
}: ChatMessageOperationsOptions) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const selection = useChatMessageSelection(displayItems);
  const { clear: clearSelection } = selection;
  const [selectionSubmitting, setSelectionSubmitting] = useState(false);
  const pendingSelection = useRef<symbol | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const operationRequests = useIdentityRequestGuard(`${composerKey}:${currentThreadId ?? ''}:${readOnly}`);

  useLayoutEffect(() => {
    setEditingMessageId(null);
    setEditingSubmitting(false);
    clearSelection();
    setSelectionSubmitting(false);
    pendingSelection.current = null;
    setActionError(null);
  }, [clearSelection, composerKey, currentThreadId, readOnly]);

  const startSelection = useCallback((itemId: string, mode: 'delete' | 'export') => {
    if (readOnly || activeTurnId || editingSubmitting || pendingSelection.current) return;
    operationRequests.invalidate();
    setActionError(null);
    setEditingMessageId(null);
    selection.start(itemId, mode);
  }, [activeTurnId, editingSubmitting, operationRequests, readOnly, selection.start]);
  const startDeleteSelection = useCallback((itemId: string) => startSelection(itemId, 'delete'), [startSelection]);
  const startExportSelection = useCallback((itemId: string) => startSelection(itemId, 'export'), [startSelection]);

  const cancelSelection = useCallback(() => {
    if (pendingSelection.current) return;
    operationRequests.invalidate();
    clearSelection();
    setActionError(null);
  }, [clearSelection, operationRequests]);

  const confirmSelection = useCallback(async (format?: DesktopConversationExportFormat) => {
    if (readOnly || pendingSelection.current || !selection.messageIds.length) return;
    if (selection.mode === 'delete' && (!onDeleteMessages || activeTurnId)) return;
    if (selection.mode === 'export' && (!onExportMessages || !format)) return;
    if (!selection.mode) return;
    const isCurrentOperation = operationRequests.begin();
    const request = Symbol();
    pendingSelection.current = request;
    setSelectionSubmitting(true);
    setActionError(null);
    try {
      if (selection.mode === 'export') {
        await onExportMessages!(selection.messageIds, format!);
        // Keep the share scope and layout intact while previewing or choosing another format.
        return;
      }
      // Runtime resolves the full persisted deletion scope, including older pages.
      await onDeleteMessages!(selection.messageIds);
      commitChatWorkspaceOperation(isCurrentOperation, clearSelection);
    } catch (unknownError) {
      commitChatWorkspaceOperation(isCurrentOperation, () => {
        setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    } finally {
      if (pendingSelection.current === request) pendingSelection.current = null;
      commitChatWorkspaceOperation(isCurrentOperation, () => setSelectionSubmitting(false));
    }
  }, [activeTurnId, clearSelection, onDeleteMessages, onExportMessages, operationRequests, readOnly, selection.messageIds, selection.mode]);

  const toggleSelection = useCallback((itemId: string, checked: boolean) => {
    if (!readOnly && !pendingSelection.current) selection.toggle(itemId, checked);
  }, [readOnly, selection.toggle]);
  const toggleAllSelection = useCallback((checked: boolean) => {
    if (!readOnly && !pendingSelection.current) selection.toggleAll(checked);
  }, [readOnly, selection.toggleAll]);

  const startEditingMessage = useCallback((message: RuntimeMessage) => {
    if (readOnly || activeTurnId || editingSubmitting || pendingSelection.current) return;
    operationRequests.invalidate();
    setActionError(null);
    clearSelection();
    setSelectionSubmitting(false);
    pendingSelection.current = null;
    setEditingMessageId(message.id);
  }, [activeTurnId, clearSelection, editingSubmitting, operationRequests, readOnly]);

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
    cancelEditingMessage,
    editingMessageId,
    editingSubmitting,
    startDeleteSelection,
    startExportSelection,
    startEditingMessage,
    submitEditingMessage,
    selection: {
      ...selection,
      loading: selectionSubmitting,
      cancel: cancelSelection,
      confirm: confirmSelection,
      toggle: toggleSelection,
      toggleAll: toggleAllSelection,
    },
  };
}
