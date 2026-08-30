// @vitest-environment happy-dom

import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import type { ChatDisplayItem } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

vi.mock('../../../../../src/features/chat/tool-runs/runtimeFeatureToolResults.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../../src/features/chat/tool-runs/runtimeFeatureToolResults.js')>();
  return {
    ...original,
    useRuntimeFeatureToolResultResolver: () => (run: RuntimeToolRun) => {
      const value = run.data;
      if (!value || typeof value !== 'object'
        || (value as { resultKind?: unknown }).resultKind !== 'test.persistent-result') return null;
      return {
        featureId: 'test-feature',
        payload: {},
        contribution: {
          id: 'test.persistent-result-view',
          resultKind: 'test.persistent-result',
          major: 1,
          payload: { parse: (payload: unknown) => payload },
          presentation: 'replace',
          workHistoryPresentation: 'persistent',
          render: () => <div className="subagent-task-card" />,
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MessageItem collaboration updates', () => {
  it('groups consecutive subagent results into one compact result grid', () => {
    const view = render(messageItem([
      persistentToolRun('spawn_first'),
      persistentToolRun('spawn_second'),
      persistentToolRun('spawn_third'),
    ]));

    const grid = view.container.querySelector('.chat-persistent-tool-result-grid');
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll(':scope > .chat-tool-runs')).toHaveLength(3);
    expect(grid?.querySelectorAll('.subagent-task-card')).toHaveLength(3);
  });

  it('keeps tool chunks around a subagent card as uniquely keyed siblings', () => {
    const keyWarnings: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      const message = values.map(String).join(' ');
      if (message.includes('same key') || message.includes('unique "key"')) keyWarnings.push(message);
    });
    const readBefore = toolRun('read_before_spawn', 'workspace_read_file');
    const persistentResult = persistentToolRun('spawn_runtime');
    const readAfter = toolRun('read_after_spawn', 'workspace_read_file');
    const view = render(messageItem([readBefore, persistentResult]));

    view.rerender(messageItem([readBefore, persistentResult, readAfter]));

    const bodyChildren = [...(view.container.querySelector('.chat-work-history__body')?.children ?? [])];
    expect(bodyChildren.map((element) => (
      element.querySelector('.subagent-task-card') ? 'subagent' : 'tools'
    ))).toEqual(['tools', 'subagent', 'tools']);
    expect(keyWarnings).toEqual([]);

    view.rerender(messageItem([readBefore, persistentResult, readAfter], true));
    expect(view.container.querySelector('.subagent-task-card')).not.toBeNull();
    expect(view.container.querySelectorAll('.chat-tool-run')).toHaveLength(0);
  });
});

function messageItem(toolRuns: RuntimeToolRun[], completed = false) {
  const segment: RuntimeMessage = {
    id: 'assistant_collaboration_tools',
    turnId: 'turn_collaboration_tools',
    role: 'assistant',
    content: '',
    createdAt: '2026-08-21T00:00:00.000Z',
    status: 'complete',
    phase: 'commentary',
    toolRuns,
  };
  const item: Extract<ChatDisplayItem, { type: 'assistant' }> = {
    type: 'assistant',
    id: 'assistant_item',
    handledSteerMessageIds: [],
    messageIds: [segment.id],
    segments: completed ? [segment, {
      id: 'assistant_collaboration_answer',
      turnId: segment.turnId,
      role: 'assistant',
      content: 'Done.',
      createdAt: '2026-08-21T00:00:01.000Z',
      status: 'complete',
      phase: 'final_answer',
    }] : [segment],
    steerMessages: [],
    turnId: segment.turnId,
  };
  return (
    <MessageItem
      activeAssistantItemId={item.id}
      activeTurnId={completed ? null : segment.turnId ?? null}
      assistantItemIdByTurnId={new Map()}
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

function persistentToolRun(id: string): RuntimeToolRun {
  return {
    ...toolRun(id, 'spawn_agent'),
    data: { resultKind: 'test.persistent-result', resultMajor: 1, payload: {} },
  };
}

function toolRun(id: string, name: string): RuntimeToolRun {
  return {
    id,
    name,
    status: 'success',
    argumentsPreview: '{}',
  };
}
