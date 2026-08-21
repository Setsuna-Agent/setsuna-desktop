// @vitest-environment happy-dom

import type { RuntimeCollaborationTask, RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import type { ChatDisplayItem } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MessageItem collaboration updates', () => {
  it('keeps tool chunks around a subagent card as uniquely keyed siblings', () => {
    const keyWarnings: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      const message = values.map(String).join(' ');
      if (message.includes('same key') || message.includes('unique "key"')) keyWarnings.push(message);
    });
    const readBefore = toolRun('read_before_spawn', 'workspace_read_file');
    const spawn = {
      ...toolRun('spawn_runtime', 'spawn_agent'),
      data: { childThreadId: 'child_runtime' },
    };
    const readAfter = toolRun('read_after_spawn', 'workspace_read_file');
    const view = render(messageItem([readBefore, spawn]));

    view.rerender(messageItem([readBefore, spawn, readAfter]));

    const bodyChildren = [...(view.container.querySelector('.chat-work-history__body')?.children ?? [])];
    expect(bodyChildren.map((element) => (
      element.classList.contains('subagent-task-card') ? 'subagent' : 'tools'
    ))).toEqual(['tools', 'subagent', 'tools']);
    expect(keyWarnings).toEqual([]);
  });
});

function messageItem(toolRuns: RuntimeToolRun[]) {
  const segment: RuntimeMessage = {
    id: 'assistant_collaboration_tools',
    turnId: 'turn_collaboration_tools',
    role: 'assistant',
    content: '',
    createdAt: '2026-08-21T00:00:00.000Z',
    status: 'streaming',
    phase: 'commentary',
    toolRuns,
  };
  const item: Extract<ChatDisplayItem, { type: 'assistant' }> = {
    type: 'assistant',
    id: 'assistant_item',
    handledSteerMessageIds: [],
    messageIds: [segment.id],
    segments: [segment],
    steerMessages: [],
    turnId: segment.turnId,
  };
  const collaborationTasks: RuntimeCollaborationTask[] = [{
    id: 'task_runtime',
    childThreadId: 'child_runtime',
    title: 'Runtime explorer',
    objective: 'Inspect the runtime architecture.',
    identity: { displayName: 'runtime-explorer', avatarSeed: 'runtime-seed' },
    status: 'running',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:01.000Z',
  }];
  return (
    <MessageItem
      activeAssistantItemId={item.id}
      activeTurnId={segment.turnId ?? null}
      assistantItemIdByTurnId={new Map()}
      collaborationTasks={collaborationTasks}
      deleteMode={false}
      editingDraft=""
      editingMessageId={null}
      editingSubmitting={false}
      expandedWorkHistoryItemIds={new Set()}
      item={item}
      onAnswerApproval={async () => undefined}
      onCancelEdit={() => undefined}
      onEditDraftChange={() => undefined}
      onWorkHistoryExpandedChange={() => undefined}
      pluginUses={[]}
      selectedForDelete={false}
    />
  );
}

function toolRun(id: string, name: string): RuntimeToolRun {
  return {
    id,
    name,
    status: 'success',
    argumentsPreview: '{}',
  };
}
