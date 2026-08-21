// @vitest-environment happy-dom

import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { useChatMessageOperations } from '../../../../../src/features/chat/hooks/useChatMessageOperations.js';

afterEach(cleanup);

describe('useChatMessageOperations', () => {
  it('keeps edit and delete state inert in read-only mode', async () => {
    const message: RuntimeMessage = {
      id: 'message_1',
      turnId: 'turn_1',
      role: 'user',
      content: 'Delegated prompt',
      createdAt: '2026-08-21T00:00:00.000Z',
      status: 'complete',
    };
    const onDeleteMessages = vi.fn(async () => undefined);
    const onEditUserMessage = vi.fn(async () => undefined);
    const view = renderHook(() => useChatMessageOperations({
      activeTurnId: null,
      composerKey: 'subagent-readonly:child_1',
      currentThreadId: 'child_1',
      displayItems: createChatDisplayItems([message]),
      onDeleteMessages,
      onEditUserMessage,
      readOnly: true,
    }));

    act(() => {
      view.result.current.startDeleteSelection(message.id);
      view.result.current.startEditingMessage(message);
      view.result.current.toggleAllDeleteSelection(true);
    });
    await act(async () => {
      await view.result.current.confirmDeleteSelection();
      await view.result.current.submitEditingMessage(message.id);
    });

    expect(view.result.current.deleteMode).toBe(false);
    expect(view.result.current.editingMessageId).toBeNull();
    expect(view.result.current.selectedDeleteCount).toBe(0);
    expect(onDeleteMessages).not.toHaveBeenCalled();
    expect(onEditUserMessage).not.toHaveBeenCalled();
  });
});
