import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import type { ChatDisplayItem } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

function userItem(message: RuntimeMessage): Extract<ChatDisplayItem, { type: 'user' }> {
  return {
    type: 'user',
    id: message.id,
    handledSteerMessageIds: [],
    guidanceProcessed: false,
    message,
    messageIds: [message.id],
    steered: false,
    steerMessages: [],
  };
}

function renderUserMessage(inputKind: RuntimeMessage['inputKind']): string {
  const message: RuntimeMessage = {
    id: `message_${inputKind}`,
    turnId: `turn_${inputKind}`,
    role: 'user',
    inputKind,
    content: 'Inspect the queue.',
    createdAt: '2026-07-27T00:00:00.000Z',
    status: 'complete',
  };
  return renderToStaticMarkup(
    <MessageItem
      activeAssistantItemId={null}
      activeTurnId={null}
      assistantItemIdByTurnId={new Map()}
      deleteMode={false}
      editingDraft=""
      editingMessageId={null}
      editingSubmitting={false}
      expandedWorkHistoryItemIds={new Set()}
      item={userItem(message)}
      onAnswerApproval={async () => undefined}
      onCancelEdit={() => undefined}
      onEditDraftChange={() => undefined}
      onPlanDecision={() => undefined}
      onStartEdit={() => undefined}
      onStartDelete={() => undefined}
      onSubmitEdit={() => undefined}
      onToggleDelete={() => undefined}
      onWorkHistoryExpandedChange={() => undefined}
      pluginUses={[]}
      selectedForDelete={false}
    />,
  );
}

describe('MessageItem user input kinds', () => {
  it('renders Plan and Goal with distinct semantic icons', () => {
    const planHtml = renderUserMessage('plan');
    const goalHtml = renderUserMessage('goal');

    expect(planHtml).toContain('chat-user-message-kind--plan');
    expect(planHtml).toContain('lucide-list-todo');
    expect(planHtml).toContain('计划');
    expect(goalHtml).toContain('chat-user-message-kind--goal');
    expect(goalHtml).toContain('lucide-target');
    expect(goalHtml).toContain('目标');
  });

  it('does not offer transcript regeneration for a Goal input', () => {
    const goalHtml = renderUserMessage('goal');

    expect(goalHtml).not.toContain('aria-label="编辑"');
  });
});
