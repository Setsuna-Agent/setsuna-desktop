// @vitest-environment happy-dom

import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import type { ChatDisplayItem } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

vi.mock('../../../../../src/features/chat/tool-runs/runtimeFeatureToolResults.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../../src/features/chat/tool-runs/runtimeFeatureToolResults.js')>();
  const ResultView = ({ payload }: { payload: unknown }) => (
    <div className="test-tail-result">{(payload as { name: string }).name}</div>
  );
  return {
    ...original,
    useRuntimeFeatureToolResultResolver: () => (run: RuntimeToolRun) => {
      const value = run.data;
      if (!value || typeof value !== 'object'
        || run.name !== 'publish_artifact'
        || !['test.tail-result', 'test.timeline-result'].includes(String(
          (value as { resultKind?: unknown }).resultKind,
        ))) return null;
      const resultKind = (value as { resultKind: 'test.tail-result' | 'test.timeline-result' }).resultKind;
      const payload = (value as { payload?: { name?: string; path?: string } }).payload;
      if (!payload?.name || !payload.path) return null;
      return {
        featureId: 'test-feature',
        payload,
        contribution: {
          id: 'test.tail-result-view',
          resultKind,
          major: 1,
          payload: { parse: (resultPayload: unknown) => resultPayload },
          identity: (resultPayload: unknown) => (resultPayload as { path: string }).path,
          placement: resultKind === 'test.timeline-result' ? 'assistant-timeline' : 'assistant-tail',
          presentation: 'replace',
          render: ResultView,
        },
      };
    },
  };
});

afterEach(cleanup);

describe('MessageItem Feature result placement', () => {
  it('renders a timeline result between assistant text segments at its tool position', () => {
    const view = render(timelineMessageItem());
    const introduction = view.getByText('Weather introduction.');
    const card = view.getByText('weather-card');
    const finalAnswer = view.getByText('Weather advice.');

    expect(introduction.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.getAllByText('weather-card')).toHaveLength(1);
    expect(card.closest('details.chat-tool-run')).toBeNull();
  });

  it('shows a completed timeline result while the assistant turn is still active', () => {
    const view = render(timelineMessageItem(false));
    const introduction = view.getByText('Weather introduction.');
    const card = view.getByText('weather-card');

    expect(introduction.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.container.querySelector('.chat-work-history')).toBeNull();
  });

  it('keeps one work header across a card, subsequent streaming work, and the final answer', () => {
    const earlierWork: RuntimeMessage = {
      id: 'weather_lookup',
      turnId: 'turn_weather',
      role: 'assistant',
      content: 'Looking up the weather.',
      createdAt: '2026-08-28T00:00:00.000Z',
      status: 'complete',
      phase: 'commentary',
      toolRuns: [{ id: 'lookup', name: 'exec_command', status: 'success' }],
    };
    const followup: RuntimeMessage = {
      ...earlierWork,
      id: 'weather_followup',
      content: '',
      status: 'streaming',
      toolRuns: [],
    };
    const view = render(timelineMessageItem(false, [], [earlierWork]));
    const header = view.container.querySelector<HTMLButtonElement>('.chat-work-history__summary')!;
    const card = view.getByText('weather-card');
    expect(view.container.querySelectorAll('.chat-work-history__summary')).toHaveLength(1);

    for (const content of ['', 'Checking tomorrow too.']) {
      view.rerender(timelineMessageItem(false, [{ ...followup, content }], [earlierWork]));
      expect(view.container.querySelectorAll('.chat-work-history__summary')).toHaveLength(1);
      expect(view.container.querySelector('.chat-work-history__summary')).toBe(header);
      expect(view.getByText('weather-card')).toBe(card);
    }
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const before = view.getByText('Looking up the weather.');
    const after = view.getByText('Checking tomorrow too.');
    expect(before.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    view.rerender(timelineMessageItem(true, [{ ...followup, content: 'Tomorrow forecast.', status: 'complete', phase: 'final_answer' }], [earlierWork]));
    expect(view.container.querySelectorAll('.chat-work-history__summary')).toHaveLength(1);
    expect(view.container.querySelector('.chat-work-history__summary')).toBe(header);
    expect(header.textContent).toContain('已处理');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(view.getByText('weather-card')).toBe(card);
    expect(view.getByText('Tomorrow forecast.')).toBeTruthy();
    expect(view.getByText('Weather advice.')).toBeTruthy();
    expect(view.queryByText('Looking up the weather.')).toBeNull();
  });

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

function timelineMessageItem(completed = true, followupSegments: RuntimeMessage[] = [], leadingSegments: RuntimeMessage[] = []) {
  const toolSegment: RuntimeMessage = {
    id: 'assistant_weather_tool',
    turnId: 'turn_weather',
    role: 'assistant',
    content: 'Weather introduction.',
    createdAt: '2026-08-28T00:00:00.000Z',
    status: 'complete',
    phase: 'commentary',
    toolRuns: [artifactRun(
      'weather_tool_1',
      'weather-card',
      'weather/hangzhou',
      'test.timeline-result',
    )],
  };
  const finalSegment: RuntimeMessage = {
    id: 'assistant_weather_answer',
    turnId: toolSegment.turnId,
    role: 'assistant',
    content: 'Weather advice.',
    createdAt: '2026-08-28T00:00:01.000Z',
    status: 'complete',
    phase: 'final_answer',
  };
  const segments = [...leadingSegments, toolSegment, ...followupSegments, ...(completed ? [finalSegment] : [])];
  const item: Extract<ChatDisplayItem, { type: 'assistant' }> = {
    type: 'assistant',
    id: 'assistant_weather_item',
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
  resultKind: 'test.tail-result' | 'test.timeline-result' = 'test.tail-result',
): RuntimeToolRun {
  return {
    id,
    name: 'publish_artifact',
    status: 'success',
    data: {
      resultKind,
      resultMajor: 1,
      payload: { name, path },
    },
  };
}
