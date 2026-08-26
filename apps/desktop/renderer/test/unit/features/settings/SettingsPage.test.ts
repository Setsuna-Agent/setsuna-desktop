import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { networkProxyFeature } from '@setsuna-desktop/feature-network-proxy/contracts';
import { networkProxyRendererFeature } from '@setsuna-desktop/feature-network-proxy/renderer';
import { modelProviderFeature } from '@setsuna-desktop/feature-model-provider/contracts';
import { modelProviderRendererFeature } from '@setsuna-desktop/feature-model-provider/renderer';
import { webDavSyncFeature } from '@setsuna-desktop/feature-webdav-sync/contracts';
import { webDavSyncRendererFeature } from '@setsuna-desktop/feature-webdav-sync/renderer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArchivedThreadsSettings, SettingsSidebar } from '../../../../src/features/settings/SettingsPage.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';

const messageCatalog = composeRendererMessages(hostMessages, [
  { module: modelProviderRendererFeature },
  { module: networkProxyRendererFeature },
  { module: webDavSyncRendererFeature },
]);

describe('SettingsSidebar', () => {
  it('groups settings navigation by purpose while preserving the section order', () => {
    const html = renderSettingsSidebar({
      activeSection: 'general',
      featureSections: [{
        descriptionKey: 'feature.modelProvider.description',
        featureId: modelProviderFeature.id,
        icon: () => createElement('svg', { 'data-settings-icon': 'model-provider' }),
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 200,
        render: () => null,
        sectionId: 'model-provider',
        titleKey: 'feature.modelProvider.title',
      }],
      onBack: vi.fn(),
      onSelectSection: vi.fn(),
    });

    expect(html.match(/role="group"/g)).toHaveLength(3);
    expect(html).toContain('应用偏好');
    expect(html).toContain('模型与服务');
    expect(html).toContain('数据与系统');
    expect(html.indexOf('应用偏好')).toBeLessThan(html.indexOf('键盘快捷键'));
    expect(html.indexOf('模型与服务')).toBeLessThan(html.indexOf('模型服务'));
    expect(html.indexOf('数据与系统')).toBeLessThan(html.indexOf('归档对话'));
  });

  it('places built-in Feature settings in their declared host group', () => {
    const html = renderSettingsSidebar({
      activeSection: 'webdav-sync',
      featureSections: [{
        descriptionKey: 'feature.webdavSync.settings.description',
        featureId: webDavSyncFeature.id,
        icon: () => createElement('svg', { 'data-settings-icon': 'webdav-sync' }),
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 350,
        render: () => null,
        sectionId: 'webdav-sync',
        titleKey: 'feature.webdavSync.settings.title',
      }],
      onBack: vi.fn(),
      onSelectSection: vi.fn(),
    });

    expect(html.match(/role="group"/g)).toHaveLength(3);
    expect(html).not.toContain('>功能<');
    expect(html).toContain('data-settings-icon="webdav-sync"');
    expect(html).toContain('同步');
  });

  it('merges Feature settings into the host group by declared order', () => {
    const html = renderSettingsSidebar({
      activeSection: 'network-proxy',
      featureSections: [{
        descriptionKey: 'feature.networkProxy.settings.description',
        featureId: networkProxyFeature.id,
        icon: () => createElement('svg', { 'data-settings-icon': 'network-proxy' }),
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 250,
        render: () => null,
        sectionId: 'network-proxy',
        titleKey: 'feature.networkProxy.settings.title',
      }],
      onBack: vi.fn(),
      onSelectSection: vi.fn(),
    });

    const featurePosition = html.indexOf('data-settings-icon="network-proxy"');
    expect(featurePosition).toBeGreaterThan(html.indexOf('模型服务'));
    expect(featurePosition).toBeLessThan(html.indexOf('专用模型'));
  });
});

function renderSettingsSidebar(props: Parameters<typeof SettingsSidebar>[0]): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN', messageCatalog },
    createElement(SettingsSidebar, props),
  ));
}

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
