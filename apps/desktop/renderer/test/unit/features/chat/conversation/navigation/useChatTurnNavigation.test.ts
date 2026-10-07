// @vitest-environment happy-dom
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ChatTurnNavigationRequest } from '@setsuna-desktop/renderer-contracts/chat';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatDisplayItems } from '../../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { chatTurnNavigationTarget, useChatTurnNavigation } from '../../../../../../src/features/chat/conversation/navigation/useChatTurnNavigation.js';

afterEach(cleanup);

const message = (id: string, turnId: string, role: RuntimeMessage['role']): RuntimeMessage => ({
  id, turnId, role, content: id, createdAt: '2026-10-07T00:00:00Z',
});

it('finds the requested run prompt instead of another run or an incomplete assistant tail', () => {
  const tail = createChatDisplayItems([
    message('answer-old', 'old', 'assistant'),
    message('prompt-new', 'new', 'user'),
    message('answer-new', 'new', 'assistant'),
  ]);
  expect(chatTurnNavigationTarget(tail, 'old', true)).toBeNull();
  expect(chatTurnNavigationTarget(tail, 'old', false)).toBe('assistant:answer-old');
  const full = createChatDisplayItems([
    message('prompt-old', 'old', 'user'), message('answer-old', 'old', 'assistant'),
    message('prompt-new', 'new', 'user'), message('answer-new', 'new', 'assistant'),
  ]);
  expect(chatTurnNavigationTarget(full, 'old', true)).toBe('user:prompt-old');
  expect(chatTurnNavigationTarget(full, 'missing', false)).toBeNull();
});

it('loads missing history, navigates once per click, and ignores snapshots for a different thread', () => {
  const viewport = document.createElement('div');
  const content = document.createElement('div');
  const prompt = document.createElement('div');
  prompt.dataset.messageId = 'user:prompt-old';
  content.append(prompt);
  const onLoadOlder = vi.fn();
  const onScrollToOffset = vi.fn();
  const history = { hasMore: true, loading: false, error: null };
  const request: ChatTurnNavigationRequest = { requestId: 1, threadId: 'execution', turnId: 'old' };
  const initialProps = {
    request, threadId: 'setup', items: createChatDisplayItems([]), history,
    contentRef: { current: content }, scrollRef: { current: viewport }, onLoadOlder, onScrollToOffset,
  };
  const view = renderHook(useChatTurnNavigation, { initialProps });
  expect(onLoadOlder).not.toHaveBeenCalled();

  view.rerender({ ...initialProps, threadId: 'execution' });
  expect(onLoadOlder).toHaveBeenCalledOnce();
  view.rerender({ ...initialProps, threadId: 'execution', history: { ...history, loading: true } });
  expect(onLoadOlder).toHaveBeenCalledOnce();
  expect(onScrollToOffset).not.toHaveBeenCalled();

  const loaded = {
    ...initialProps, threadId: 'execution', history: { ...history, hasMore: false },
    items: createChatDisplayItems([message('prompt-old', 'old', 'user')]),
  };
  view.rerender(loaded);
  expect(onScrollToOffset).toHaveBeenCalledOnce();
  view.rerender({ ...loaded, request: { ...request }, items: [...loaded.items] });
  expect(onScrollToOffset).toHaveBeenCalledOnce();
  view.rerender({ ...loaded, request: { ...request, requestId: 2 } });
  expect(onScrollToOffset).toHaveBeenCalledTimes(2);

  view.rerender({ ...loaded, threadId: 'other', request: { ...request, requestId: 3 } });
  expect(onScrollToOffset).toHaveBeenCalledTimes(2);
});
