import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import {
  registerSettingsPage,
  type SettingsPageSlotProps,
} from '@setsuna-desktop/renderer-contracts/settings';
import { CloudCog } from 'lucide-react';
import { webDavSyncFeature } from '../contracts/index.js';
import type { WebDavSyncDesktopBridge } from '../contracts/index.js';
import { webDavSyncRendererHostCapability } from './capabilities.js';
import { WebDavSyncViewProvider } from './context.js';
import { webDavSyncMessages } from './messages.js';
import { WebDavSyncSettings } from './WebDavSyncSettings.js';

const dependencies = defineRendererDependencies({
  host: requiredCapability(webDavSyncRendererHostCapability),
});

export const webDavSyncRendererFeature = defineRendererFeature({
  definition: webDavSyncFeature,
  dependencies,
  messages: [webDavSyncMessages],
  setup(context) {
    const { bridge } = context.dependencies.host;
    registerSettingsPage(context.ui, {
        entryId: 'webdav-sync.settings-page',
        icon: CloudCog,
        sectionId: 'webdav-sync',
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 350,
        titleKey: 'feature.webdavSync.settings.title',
        descriptionKey: 'feature.webdavSync.settings.description',
        render: (props) => <WebDavSyncSettingsView bridge={bridge} {...props} />,
    });
  },
});

function WebDavSyncSettingsView({
  bridge,
  translate,
  ui,
}: SettingsPageSlotProps & Readonly<{
  bridge: WebDavSyncDesktopBridge | null;
}>) {
  const locale = typeof document === 'undefined'
    ? 'zh-CN'
    : document.documentElement.lang || navigator.language || 'zh-CN';
  return (
    <WebDavSyncViewProvider bridge={bridge} locale={locale} translate={translate} ui={ui}>
      <WebDavSyncSettings />
    </WebDavSyncViewProvider>
  );
}
