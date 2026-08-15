import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SidebarThreadList } from '../../../../src/app/sidebar/SidebarThreadList.js';

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('SidebarThreadList', () => {
  it('initially renders at most twenty global conversations and offers the next batch', () => {
    const html = renderThreadList(21, 'global');

    expect(html).toContain('conversation-20');
    expect(html).not.toContain('conversation-21');
    expect(html).toContain('aria-label="再显示 1 个对话"');
    expect(html).toContain('展开显示');
  });

  it('hides the global expansion control when exactly twenty conversations exist', () => {
    const html = renderThreadList(20, 'global');

    expect(html).toContain('conversation-20');
    expect(html).not.toContain('展开显示');
  });

  it('initially renders at most five project conversations and offers the next batch', () => {
    const html = renderThreadList(6, 'project');

    expect(html).toContain('conversation-5');
    expect(html).not.toContain('conversation-6');
    expect(html).toContain('aria-label="再显示 1 个对话"');
    expect(html).toContain('展开显示');
  });

  it('hides the project expansion control when exactly five conversations exist', () => {
    const html = renderThreadList(5, 'project');

    expect(html).toContain('conversation-5');
    expect(html).not.toContain('展开显示');
  });
});

function renderThreadList(threadCount: number, variant: 'global' | 'project') {
  return renderToStaticMarkup(createElement(SidebarThreadList, {
    menuThreadId: null,
    runningThreadId: null,
    selectedThreadId: null,
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
