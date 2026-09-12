// @vitest-environment happy-dom

import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import { chatDisplayItemRenderKey, createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { withRendererPluginTestHost } from '../../../support/RendererPluginTestHost.js';
import { toolRun } from '../tool-runs/RuntimeToolRuns.support.js';

afterEach(cleanup);

describe('assistant transcript streaming', () => {
  it('preserves open tool output across compaction and successive assistant segments', () => {
    const onExpandedChange = vi.fn();
    const history: RuntimeMessage[] = [{
      id: 'assistant_first', turnId: 'turn_1', role: 'assistant',
      createdAt: '2026-09-12T00:00:00.000Z', status: 'complete', content: 'Inspecting the architecture',
      toolRuns: [
        { ...toolRun('shell_first', 'exec_command', { cmd: 'git status --short' }), resultPreview: 'Stdout:\ncommand output' },
        toolRun('read_first', 'read_file', { file_path: 'src/first.ts' }),
      ],
    }];
    const panel = (messages: RuntimeMessage[], compacting = false) => {
      const item = createChatDisplayItems(messages)[0]!;
      return withRendererPluginTestHost(<MessageItem
        key={chatDisplayItemRenderKey(item)}
        item={item}
        activeTurnId="turn_1"
        activeAssistantItemId={item.id}
        assistantItemIdByTurnId={new Map()}
        contextCompactionRunning={compacting}
        deleteMode={false}
        editingDraft=""
        editingMessageId={null}
        editingSubmitting={false}
        expandedWorkHistoryItemIds={new Set()}
        onAnswerApproval={vi.fn()}
        onCancelEdit={vi.fn()}
        onEditDraftChange={vi.fn()}
        onWorkHistoryExpandedChange={onExpandedChange}
        pluginUses={[]}
        selectedForDelete={false}
      />);
    };
    const view = render(panel(history));
    const summary = view.container.querySelector('.chat-work-history__summary')!;
    const root = view.container.querySelector<HTMLDetailsElement>('.chat-tool-runs > details')!;
    act(() => { root.open = true; fireEvent(root, new Event('toggle')); });
    const command = root.querySelector<HTMLDetailsElement>('details.chat-tool-run--shell')!;
    act(() => { command.open = true; fireEvent(command, new Event('toggle')); });
    const output = view.getByText('command output');
    const firstFile = view.getByText('first.ts');
    const expectHistoryPreserved = () => {
      expect(view.container.querySelector('.chat-work-history__summary')).toBe(summary);
      expect(summary.getAttribute('aria-expanded')).toBe('true');
      expect(root.isConnected && root.open).toBe(true);
      expect(command.isConnected && command.open).toBe(true);
      expect(view.getByText('command output')).toBe(output);
      expect(view.getByText('first.ts')).toBe(firstFile);
    };
    view.rerender(panel(history, true));
    expectHistoryPreserved();
    history[0] = { ...history[0]!, visibility: 'transcript' };
    history.push({
      id: 'compaction', turnId: 'turn_1', role: 'user', content: 'Context summary',
      createdAt: '2026-09-12T00:00:01.000Z', status: 'complete',
      contextCompaction: {
        compactedMessageCount: 174, compactedTokens: 128, keptRecentMessageCount: 2,
        maxContextTokensK: 256, originalMessageCount: 176, originalTokens: 512,
        transcriptAfterMessageId: 'assistant_first',
      },
    });
    view.rerender(panel(history));
    expectHistoryPreserved();
    for (let index = 0; index < 3; index += 1) {
      const next: RuntimeMessage = {
        id: `assistant_${index}`, turnId: 'turn_1', role: 'assistant', content: '',
        createdAt: '2026-09-12T00:00:02.000Z', status: 'streaming',
      };
      view.rerender(panel([...history, next]));
      expectHistoryPreserved();
      next.toolRuns = [toolRun(`shell_${index}`, 'exec_command', { cmd: `echo ${index}` }, 'running')];
      view.rerender(panel([...history, next]));
      expectHistoryPreserved();
      history.push({ ...next, status: 'complete', toolRuns: next.toolRuns.map((run) => ({ ...run, status: 'success' })) });
      view.rerender(panel(history));
      expectHistoryPreserved();
    }
  });
});
