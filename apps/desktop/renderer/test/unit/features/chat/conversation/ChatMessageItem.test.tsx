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

function renderUserMessage(inputKind: RuntimeMessage['inputKind'], editing = false, content = 'Inspect the queue.'): string {
  const message: RuntimeMessage = {
    id: `message_${inputKind}`,
    turnId: `turn_${inputKind}`,
    role: 'user',
    inputKind,
    content,
    createdAt: '2026-07-27T00:00:00.000Z',
    status: 'complete',
  };
  return renderToStaticMarkup(
    <MessageItem
      activeAssistantItemId={null}
      activeTurnId={null}
      assistantItemIdByTurnId={new Map()}
      deleteMode={false}
      editingDraft={editing ? message.content : ''}
      editingMessageId={editing ? message.id : null}
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

describe('MessageItem user messages', () => {
  it('does not offer transcript regeneration for a Goal input', () => {
    const goalHtml = renderUserMessage('goal');

    expect(goalHtml).not.toContain('aria-label="编辑"');
  });

  it('omits the message timestamp while editing', () => {
    const editorHtml = renderUserMessage('message', true);

    expect(editorHtml).toContain('class="chat-user-edit"');
    expect(editorHtml).not.toContain('<time');
  });

  it('keeps workspace mentions inline with the surrounding message text', () => {
    const html = renderUserMessage('message', false, '请看 @agent-pc/ 以及 @agent-mobile/ 现在处理');

    expect(html).toContain('class="chat-user-message-content__body"');
    expect(html).toMatch(/chat-user-message-content__body">请看 .*agent-pc\/.* 以及 .*agent-mobile\/.* 现在处理<\/span>/u);
  });
});
