import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SidebarThreadList } from '../../../../src/app/sidebar/SidebarThreadList.js';

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('SidebarThreadList', () => {
  it('initially renders five project conversations', () => {
    const html = renderThreadList(6, 'project');

    expect(html).toContain('conversation-5');
    expect(html).not.toContain('conversation-6');
    expect(html).toContain('aria-label="再显示 1 个对话"');
    expect(html).toContain('展开显示');
  });

  it('initially renders twenty global conversations', () => {
    const html = renderThreadList(21, 'global');

    expect(html).toContain('conversation-20');
    expect(html).not.toContain('conversation-21');
    expect(html).toContain('aria-label="再显示 1 个对话"');
  });

  it.each([
    ['project', 5],
    ['global', 20],
  ] as const)('hides the %s expansion control at its batch boundary', (variant, count) => {
    const html = renderThreadList(count, variant);

    expect(html).toContain(`conversation-${count}`);
    expect(html).not.toContain('展开显示');
  });

  it('keeps selected and running conversations visible beyond the initial batch', () => {
    const html = renderThreadList(22, 'project', {
      runningThreadId: 'thread-22',
      selectedThreadId: 'thread-21',
    });

    expect(html).toContain('conversation-21');
    expect(html).toContain('conversation-22');
    expect(html).not.toContain('展开显示');
  });
});

function renderThreadList(
  threadCount: number,
  variant: 'global' | 'project',
  active: { runningThreadId?: string | null; selectedThreadId?: string | null } = {},
) {
  return renderToStaticMarkup(createElement(SidebarThreadList, {
    menuThreadId: null,
    runningThreadId: active.runningThreadId ?? null,
    selectedThreadId: active.selectedThreadId ?? null,
    threads: Array.from({ length: threadCount }, (_, index) => createThread(index + 1)),
    variant,
    onArchive: () => undefined,
    onRename: () => undefined,
    onSelect: () => undefined,
    onToggleMenu: () => undefined,
  }));
}

function createThread(index: number): RuntimeThreadSummary {
  return {
    id: `thread-${index}`,
    title: `conversation-${index}`,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
  };
}
