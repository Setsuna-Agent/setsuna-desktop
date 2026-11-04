import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { networkProxyFeature } from '@setsuna-desktop/feature-network-proxy/contracts';
import { networkProxyRendererFeature } from '@setsuna-desktop/feature-network-proxy/renderer';
import { modelProviderFeature } from '@setsuna-desktop/feature-model-provider/contracts';
import { modelProviderRendererFeature } from '@setsuna-desktop/feature-model-provider/renderer';
import type {
  SettingsPageEntryDescriptor,
  SettingsPageMetadata,
} from '@setsuna-desktop/renderer-contracts/settings';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from '../../../../src/features/settings/SettingsPage.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';

const messageCatalog = composeRendererMessages(hostMessages, [
  { module: modelProviderRendererFeature },
  { module: networkProxyRendererFeature },
]);

describe('SettingsSidebar', () => {
  it('places network settings in the workspace group after model settings', () => {
    const html = renderSettingsSidebar({
      activeSection: 'network-proxy',
      pages: [...basePages, page({
        descriptionKey: 'feature.networkProxy.settings.description',
        icon: () => createElement('svg', { 'data-settings-icon': 'network-proxy' }),
        location: 'settings',
        navigationGroupId: 'workspace',
        order: 400,
        sectionId: 'network-proxy',
        titleKey: 'feature.networkProxy.settings.title',
      }, networkProxyFeature.id)],
      onSelectSection: vi.fn(),
    });

    const featurePosition = html.indexOf('代理服务器');
    expect(featurePosition).toBeGreaterThan(html.indexOf('工作环境'));
    expect(featurePosition).toBeLessThan(html.indexOf('数据管理'));
  });
});

const basePages: readonly SettingsPageEntryDescriptor[] = [
  page({
    location: 'settings',
    navigationGroupId: 'preferences',
    order: 100,
    sectionId: 'general',
    titleKey: 'settings.section.general',
  }, 'host'),
  page({
    location: 'settings',
    navigationGroupId: 'preferences',
    order: 200,
    sectionId: 'shortcuts',
    titleKey: 'settings.section.shortcuts',
  }, 'host'),
  page({
    location: 'settings',
    navigationGroupId: 'models-and-usage',
    order: 100,
    sectionId: 'model-provider',
    titleKey: 'feature.modelProvider.title',
  }, modelProviderFeature.id),
  page({
    location: 'settings',
    navigationGroupId: 'models-and-usage',
    order: 200,
    sectionId: 'taskModels',
    titleKey: 'settings.section.taskModels',
  }, 'host'),
  page({
    location: 'settings',
    navigationGroupId: 'data-management',
    order: 200,
    sectionId: 'archives',
    titleKey: 'settings.section.archives',
  }, 'host'),
];

function page(metadata: SettingsPageMetadata, featureId: string): SettingsPageEntryDescriptor {
  return Object.freeze({
    entryId: `fixture.${metadata.sectionId.toLowerCase()}`,
    key: `settings/${metadata.sectionId}`,
    metadata,
    owner: Object.freeze({ featureId, pluginId: `feature.${featureId}`, scopeId: `fixture:${featureId}` }),
  });
}

function renderSettingsSidebar(props: Parameters<typeof SettingsSidebar>[0]): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN', messageCatalog },
    createElement(SettingsSidebar, props),
  ));
}
