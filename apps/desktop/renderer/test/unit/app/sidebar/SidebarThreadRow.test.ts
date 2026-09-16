// @vitest-environment happy-dom

import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarThreadRow } from '../../../../src/app/sidebar/SidebarThreadRow.js';

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({ SidebarFloatingMenu: () => null }));

afterEach(cleanup);

describe('SidebarThreadRow', () => {
  it.each([
    { source: 'runtime snapshot', activeTurnId: 'turn_goal_1', running: false },
    { source: 'current-thread fallback', activeTurnId: undefined, running: true },
  ])('makes archiving unavailable while the $source is running, then restores the action', ({ activeTurnId, running }) => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    const row = (value: RuntimeThreadSummary, isRunning = false) => createElement(SidebarThreadRow, {
      menuOpen: false,
      running: isRunning,
      selected: false,
      thread: value,
      variant: 'project',
      onArchive,
      onRename: () => undefined,
      onSelect,
      onToggleMenu: () => undefined,
      onTogglePin: () => undefined,
    });
    const view = render(row(thread));
    expect(view.getByRole('button', { name: '归档对话' })).toBeTruthy();

    view.rerender(row({ ...thread, activeTurnId }, running));
    expect(view.getByRole('status', { name: '对话进行中' })).toBeTruthy();
    expect(view.queryByRole('button', { name: '归档对话', hidden: true })).toBeNull();
    expect(onArchive).not.toHaveBeenCalled();

    view.rerender(row(thread));
    fireEvent.click(view.getByRole('button', { name: '归档对话' }));
    expect(onArchive).toHaveBeenCalledExactlyOnceWith(thread);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

const thread: RuntimeThreadSummary = {
  id: 'thread_1',
  title: 'Running thread',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  archived: false,
  messageCount: 0,
  lastMessagePreview: '',
};
