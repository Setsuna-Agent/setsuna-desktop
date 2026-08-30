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
        || run.name !== 'publish_artifact'
        || (value as { resultKind?: unknown }).resultKind !== 'test.tail-result') return null;
      const payload = (value as { payload?: { name?: string; path?: string } }).payload;
      if (!payload?.name || !payload.path) return null;
      return {
        featureId: 'test-feature',
        payload,
        contribution: {
          id: 'test.tail-result-view',
          resultKind: 'test.tail-result',
          major: 1,
          payload: { parse: (resultPayload: unknown) => resultPayload },
          identity: (resultPayload: unknown) => (resultPayload as { path: string }).path,
          placement: 'assistant-tail',
          presentation: 'replace',
          render: ({ payload: resultPayload }: { payload: unknown }) => (
            <div className="test-tail-result">
              {(resultPayload as { name: string }).name}
            </div>
          ),
        },
      };
    },
  };
});

afterEach(cleanup);

describe('MessageItem assistant-tail Feature results', () => {
  it('waits for completion and renders the result after the final answer', () => {
    const view = render(messageItem(false));
    expect(view.container.querySelector('.test-tail-result')).toBeNull();

    view.rerender(messageItem(true));
    const finalAnswer = view.getByText('Final answer.');
    const tailResult = view.getByText('report.pdf');

    expect(finalAnswer.compareDocumentPosition(tailResult) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tailResult.closest('details.chat-tool-run')).toBeNull();
  });

  it('keeps only the latest result when the same file is published again', () => {
    const view = render(messageItem(true, [
      artifactRun('publish_artifact_old', 'report-draft.pdf', 'output/report.pdf'),
      artifactRun('publish_artifact_latest', 'report.pdf', 'output/report.pdf'),
    ]));

    expect(view.queryByText('report-draft.pdf')).toBeNull();
    expect(view.getAllByText('report.pdf')).toHaveLength(1);
  });
});

function messageItem(completed: boolean, runs = [artifactRun()]) {
  const toolSegment: RuntimeMessage = {
    id: 'assistant_artifact_tool',
    turnId: 'turn_artifact',
    role: 'assistant',
    content: '',
    createdAt: '2026-08-28T00:00:00.000Z',
    status: 'complete',
    phase: 'commentary',
    toolRuns: runs,
  };
  const segments = completed ? [toolSegment, {
    id: 'assistant_artifact_answer',
    turnId: toolSegment.turnId,
    role: 'assistant' as const,
    content: 'Final answer.',
    createdAt: '2026-08-28T00:00:01.000Z',
    status: 'complete' as const,
    phase: 'final_answer' as const,
  }] : [toolSegment];
  const item: Extract<ChatDisplayItem, { type: 'assistant' }> = {
    type: 'assistant',
    id: 'assistant_item',
    handledSteerMessageIds: [],
    messageIds: segments.map((segment) => segment.id),
    segments,
    steerMessages: [],
    turnId: toolSegment.turnId,
  };
  return (
    <MessageItem
      activeAssistantItemId={completed ? null : item.id}
      activeTurnId={completed ? null : toolSegment.turnId ?? null}
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

function artifactRun(
  id = 'publish_artifact_1',
  name = 'report.pdf',
  path = 'output/report.pdf',
): RuntimeToolRun {
  return {
    id,
    name: 'publish_artifact',
    status: 'success',
    data: {
      resultKind: 'test.tail-result',
      resultMajor: 1,
      payload: { name, path },
    },
  };
}
