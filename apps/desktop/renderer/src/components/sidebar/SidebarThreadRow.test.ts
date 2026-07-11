import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { SidebarThreadRow } from './SidebarThreadRow.js';

vi.mock('./SidebarFloatingMenu.js', () => ({ SidebarFloatingMenu: () => null }));

describe('SidebarThreadRow', () => {
  it('shows loading from the thread runtime snapshot without relying on the selected thread prop', () => {
    const html = renderRow({ ...thread, activeTurnId: 'turn_goal_1' });

    expect(html).toContain('is-running');
    expect(html).toContain('aria-label="对话进行中"');
  });

  it('keeps the explicit current-thread running state as a snapshot race fallback', () => {
    const html = renderRow(thread, true);

    expect(html).toContain('is-running');
    expect(html).toContain('aria-label="对话进行中"');
  });
});

function renderRow(value: RuntimeThreadSummary, running = false): string {
  return renderToStaticMarkup(createElement(SidebarThreadRow, {
    menuOpen: false,
    running,
    selected: false,
    thread: value,
    variant: 'project',
    onArchive: () => undefined,
    onRename: () => undefined,
    onSelect: () => undefined,
    onToggleMenu: () => undefined,
  }));
}

const thread: RuntimeThreadSummary = {
  id: 'thread_1',
  title: 'Running thread',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  archived: false,
  messageCount: 0,
  lastMessagePreview: '',
};
