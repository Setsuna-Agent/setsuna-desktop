import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  nextSidebarVisibleCount,
  SidebarThreadList,
} from '../../../../src/app/sidebar/SidebarThreadList.js';

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

  it('expands from a pinned conversation instead of the stale page boundary', () => {
    expect(nextSidebarVisibleCount(5, 11, 5, 22)).toBe(16);
    expect(nextSidebarVisibleCount(20, 20, 20, 22)).toBe(22);
  });

  it('renders conversations newest-first by creation time regardless of input order', () => {
    const html = renderToStaticMarkup(createElement(SidebarThreadList, {
      menuThreadId: null,
      runningThreadId: null,
      selectedThreadId: null,
      threads: [
        createThreadWithTime(1, '2026-07-01T00:00:00.000Z'),
        createThreadWithTime(3, '2026-07-09T00:00:00.000Z'),
        createThreadWithTime(2, '2026-07-05T00:00:00.000Z'),
      ],
      variant: 'global',
      onArchive: () => undefined,
      onRename: () => undefined,
      onSelect: () => undefined,
      onToggleMenu: () => undefined,
    }));

    expect(html.indexOf('conversation-3')).toBeLessThan(html.indexOf('conversation-2'));
    expect(html.indexOf('conversation-2')).toBeLessThan(html.indexOf('conversation-1'));
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

function createThreadWithTime(index: number, createdAt: string): RuntimeThreadSummary {
  return { ...createThread(index), createdAt, updatedAt: createdAt };
}
