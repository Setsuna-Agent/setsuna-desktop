import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArchivedThreadsSettings, SettingsSidebar } from '../../../../src/features/settings/SettingsPage.js';
import { updateDownloadSourceName } from '../../../../src/features/settings/sections/AboutSettings.js';
import { I18nProvider, translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

describe('SettingsSidebar', () => {
  it('uses the shared workbench sidebar track', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      activeSection: 'general',
      onBack: vi.fn(),
      onSelectSection: vi.fn(),
    }));

    expect(html).toContain('<nav class="app-sidebar desktop-settings-sidebar chat-user-settings__nav">');
    expect(html).toContain('模型服务');
    expect(html).toContain('专用模型');
    expect(html).not.toContain('chat-user-settings--page');
  });

  it('renders the settings navigation in English when selected', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: 'en-US' },
        createElement(SettingsSidebar, {
          activeSection: 'general',
          onBack: vi.fn(),
          onSelectSection: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Model providers');
    expect(html).toContain('Task models');
    expect(html).toContain('General');
    expect(html).not.toContain('模型服务');
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

describe('updateDownloadSourceName', () => {
  it('localizes the built-in GitHub source without changing custom names', () => {
    const t: Translate = (key, params) => translate('en-US', key, params);

    expect(updateDownloadSourceName({ builtIn: true, id: 'github-direct', name: 'GitHub 直连' }, t)).toBe('GitHub Direct');
    expect(updateDownloadSourceName({ builtIn: false, id: 'custom-1', name: '公司镜像' }, t)).toBe('公司镜像');
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
