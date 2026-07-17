import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { ArchivedThreadsSettings, SettingsSidebar } from './SettingsPage.js';

describe('SettingsSidebar', () => {
  it('uses the shared workbench sidebar track', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      activeSection: 'general',
      onBack: vi.fn(),
      onSelectSection: vi.fn(),
    }));

    expect(html).toContain('<nav class="app-sidebar desktop-settings-sidebar chat-user-settings__nav">');
    expect(html).not.toContain('chat-user-settings--page');
  });
});

describe('ArchivedThreadsSettings', () => {
  it('shows the delete-all action when archived threads exist', () => {
    const html = renderArchivedThreads([archivedThread]);

    expect(html).toContain('全部删除');
    expect(html).toContain('示例归档对话');
  });

  it('hides the delete-all action when the archive is empty', () => {
    const html = renderArchivedThreads([]);

    expect(html).toContain('暂无归档对话');
    expect(html).not.toContain('全部删除');
  });
});

function renderArchivedThreads(threads: RuntimeThreadSummary[]): string {
  return renderToStaticMarkup(createElement(ArchivedThreadsSettings, {
    threads,
    onDelete: vi.fn(),
    onDeleteAll: vi.fn(),
    onRestore: vi.fn(),
  }));
}

const archivedThread: RuntimeThreadSummary = {
  id: 'thread_archived_1',
  title: '示例归档对话',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  archived: true,
  messageCount: 3,
  lastMessagePreview: '已归档',
};
