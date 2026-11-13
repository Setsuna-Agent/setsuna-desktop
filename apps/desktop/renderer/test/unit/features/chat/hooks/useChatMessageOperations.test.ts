// @vitest-environment happy-dom

import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { useChatMessageOperations } from '../../../../../src/features/chat/hooks/useChatMessageOperations.js';

afterEach(cleanup);

describe('useChatMessageOperations', () => {
  it('deduplicates export submission and keeps a new conversation selection intact when an old save finishes', async () => {
    const completions: Array<() => void> = [];
    const onExportMessages = vi.fn(() => new Promise<{ cancelled?: boolean }>((resolve) => {
      completions.push(() => resolve({}));
    }));
    const view = renderHook(({ threadId }) => useChatMessageOperations({
      activeTurnId: null, composerKey: 'chat', currentThreadId: threadId, onExportMessages,
      displayItems: createChatDisplayItems([{ id: threadId, role: 'assistant', content: threadId, createdAt: '' }]),
    }), { initialProps: { threadId: 'thread-a' } });
    act(() => view.result.current.startExportSelection('thread-a'));
    let first!: Promise<void>;
    await act(async () => {
      first = view.result.current.selection.confirm('png');
      await view.result.current.selection.confirm('png');
    });
    expect(onExportMessages).toHaveBeenCalledTimes(1);
    view.rerender({ threadId: 'thread-b' });
    act(() => view.result.current.startExportSelection('thread-b'));
    let second!: Promise<void>;
    act(() => { second = view.result.current.selection.confirm('html'); });
    await act(async () => { completions[0](); await first; });
    expect(view.result.current.selection.messageIds).toEqual(['thread-b']);
    expect(view.result.current.selection.loading).toBe(true);
    await act(async () => { completions[1](); await second; });
    expect(view.result.current.selection.mode).toBe('export');
    expect(view.result.current.selection.messageIds).toEqual(['thread-b']);
    expect(view.result.current.selection.loading).toBe(false);
  });

  it('keeps a new conversation editor intact when an earlier edit finishes after navigation', async () => {
    const message: RuntimeMessage = { id: 'message-a', role: 'user', content: 'Original', createdAt: '2026-10-16T00:00:00Z' };
    let complete!: () => void;
    const onEditUserMessage = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const view = renderHook(({ threadId }) => useChatMessageOperations({
      activeTurnId: null, composerKey: 'chat-transcript', currentThreadId: threadId,
      displayItems: createChatDisplayItems([message]), onEditUserMessage,
    }), { initialProps: { threadId: 'thread-a' } });
    act(() => view.result.current.startEditingMessage(message));
    let request!: Promise<boolean>;
    act(() => { request = view.result.current.submitEditingMessage(message.id, { content: 'Edited', attachments: [] }); });
    expect(view.result.current.editingSubmitting).toBe(true);
    view.rerender({ threadId: 'thread-b' });
    act(() => view.result.current.startEditingMessage({ ...message, id: 'message-b' }));
    await act(async () => { complete(); expect(await request).toBe(true); });
    expect(view.result.current.editingMessageId).toBe('message-b');
    expect(view.result.current.editingSubmitting).toBe(false);
    expect(view.result.current.actionError).toBeNull();
  });

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
      view.result.current.selection.toggleAll(true);
    });
    await act(async () => {
      await view.result.current.selection.confirm();
      await view.result.current.submitEditingMessage(message.id, { content: message.content });
    });

    expect(view.result.current.selection.mode).toBeNull();
    expect(view.result.current.editingMessageId).toBeNull();
    expect(view.result.current.selection.selectedCount).toBe(0);
    expect(onDeleteMessages).not.toHaveBeenCalled();
    expect(onEditUserMessage).not.toHaveBeenCalled();
  });
});
