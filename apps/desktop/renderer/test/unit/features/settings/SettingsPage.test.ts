import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArchivedThreadsSettings, SettingsSidebar } from '../../../../src/features/settings/SettingsPage.js';
import { updateDownloadSourceName } from '../../../../src/features/settings/sections/AboutSettings.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

describe('SettingsSidebar', () => {
  it('exposes keyboard shortcuts, usage statistics, and sync in settings navigation', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      activeSection: 'general',
      onBack: vi.fn(),
      onSelectSection: vi.fn(),
    }));

    expect(html).toContain('键盘快捷键');
    expect(html).toContain('用量统计');
    expect(html).toContain('同步');
    const en: Translate = (key, params) => translate('en-US', key, params);
    expect(updateDownloadSourceName({ builtIn: true, id: 'github-direct', name: 'GitHub 直连' }, en)).toBe('GitHub Direct');
    expect(updateDownloadSourceName({ builtIn: false, id: 'custom-1', name: '公司镜像' }, en)).toBe('公司镜像');
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
