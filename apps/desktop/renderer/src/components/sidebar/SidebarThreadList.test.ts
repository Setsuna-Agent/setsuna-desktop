import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { SidebarThreadList } from './SidebarThreadList.js';

vi.mock('./SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('SidebarThreadList', () => {
  it('initially renders at most five conversations and offers the next batch', () => {
    const html = renderThreadList(6);

    expect(html).toContain('conversation-5');
    expect(html).not.toContain('conversation-6');
    expect(html).toContain('aria-label="再显示 1 个对话"');
    expect(html).toContain('展开显示');
  });

  it('hides the expansion control after every conversation is visible', () => {
    const html = renderThreadList(5);

    expect(html).toContain('conversation-5');
    expect(html).not.toContain('展开显示');
  });
});

function renderThreadList(threadCount: number) {
  return renderToStaticMarkup(createElement(SidebarThreadList, {
    menuThreadId: null,
    runningThreadId: null,
    selectedThreadId: null,
    threads: Array.from({ length: threadCount }, (_, index) => createThread(index + 1)),
    variant: 'global',
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
