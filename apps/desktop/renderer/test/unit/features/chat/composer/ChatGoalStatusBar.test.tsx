// @vitest-environment happy-dom

import type { RuntimeThreadGoal, RuntimeThreadGoalPatch } from '@setsuna-desktop/contracts';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGoalStatusBar } from '../../../../../src/features/chat/composer/ChatGoalStatusBar.js';
import { formatGoalDuration } from '../../../../../src/features/chat/goalFormatting.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChatGoalStatusBar', () => {
  it('formats and renders accumulated running time without a Token budget', () => {
    const { container } = renderGoalBar(goal({ timeUsedSeconds: 65 }));

    expect(screen.getByText('1m 5s')).toBeTruthy();
    expect(screen.getByText('进行中的目标')).toBeTruthy();
    expect(container.textContent).not.toContain('预算');
    expect(formatGoalDuration(3_661)).toBe('1h 1m 1s');
  });

  it('pauses an active goal', async () => {
    const onUpdateGoal = vi.fn(async () => undefined);
    renderGoalBar(goal(), { onUpdateGoal });

    await userEvent.click(screen.getByRole('button', { name: '暂停目标' }));

    await waitFor(() => expect(onUpdateGoal).toHaveBeenCalledWith({ status: 'paused' }));
  });

  it('adds the live active turn duration to persisted elapsed time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T00:00:10.000Z'));

    renderGoalBar(goal({ timeUsedSeconds: 5 }), {
      activeTurnStartedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(screen.getByText('15s')).toBeTruthy();
  });

  it('resumes, edits, and clears a paused goal through explicit controls', async () => {
    const onClearGoal = vi.fn(async () => undefined);
    const onUpdateGoal = vi.fn(async () => undefined);
    renderGoalBar(goal({ status: 'paused' }), { onClearGoal, onUpdateGoal });

    await userEvent.click(screen.getByRole('button', { name: '继续目标' }));
    await waitFor(() => expect(onUpdateGoal).toHaveBeenCalledWith({ status: 'active' }));

    await userEvent.click(screen.getByRole('button', { name: '编辑目标' }));
    const input = screen.getByRole('textbox', { name: '' });
    await userEvent.clear(input);
    await userEvent.type(input, '更新后的可验证目标');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onUpdateGoal).toHaveBeenCalledWith({
      objective: '更新后的可验证目标',
    }));

    await userEvent.click(screen.getByRole('button', { name: '删除目标' }));
    await waitFor(() => expect(onClearGoal).toHaveBeenCalledOnce());
  });

  it('closes an open editor when the displayed Goal identity changes', async () => {
    const view = renderGoalBar(goal({ objective: 'First objective' }));
    await userEvent.click(screen.getByRole('button', { name: '编辑目标' }));
    await userEvent.clear(screen.getByRole('textbox', { name: '' }));
    await userEvent.type(screen.getByRole('textbox', { name: '' }), 'Unsaved draft');

    view.rerender(
      <I18nProvider initialLocale="zh-CN">
        <ChatGoalStatusBar
          key="thread_2:goal_2"
          goal={goal({ id: 'goal_2', threadId: 'thread_2', objective: 'Second objective' })}
          onClearGoal={async () => undefined}
          onUpdateGoal={async () => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.queryByRole('textbox', { name: '' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: '编辑目标' }));
    expect((screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement).value).toBe('Second objective');
  });
});

function renderGoalBar(
  value: RuntimeThreadGoal,
  handlers: {
    activeTurnStartedAt?: string;
    onClearGoal?: () => Promise<void>;
    onUpdateGoal?: (patch: RuntimeThreadGoalPatch) => Promise<void>;
  } = {},
) {
  return render(
    <I18nProvider initialLocale="zh-CN">
      <ChatGoalStatusBar
        key={`${value.threadId}:${value.id}`}
        activeTurnStartedAt={handlers.activeTurnStartedAt}
        goal={value}
        onClearGoal={handlers.onClearGoal ?? (async () => undefined)}
        onUpdateGoal={handlers.onUpdateGoal ?? (async () => undefined)}
      />
    </I18nProvider>,
  );
}

function goal(overrides: Partial<RuntimeThreadGoal> = {}): RuntimeThreadGoal {
  return {
    version: 1,
    id: 'goal_1',
    threadId: 'thread_1',
    objective: '完成并验证目标状态栏',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 42,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
