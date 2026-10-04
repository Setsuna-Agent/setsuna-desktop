import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { optionalCapability } from '@setsuna-desktop/feature-core/capability';
import { Globe } from 'lucide-react';
import { browserRendererHostCapability } from './settings/context.js';
import { lazy, Suspense } from 'react';
import { browserFeature } from '../contracts/index.js';
import { browserMessages } from './messages.js';

const BrowserWorkspacePanel = lazy(async () => {
  const module = await import('./BrowserWorkspacePanel.js');
  return { default: module.BrowserWorkspacePanel };
});
const BrowserSettingsPage = lazy(async () => ({ default: (await import('./settings/BrowserSettingsPage.js')).BrowserSettingsPage }));

export const browserRendererFeature = defineRendererFeature({
  definition: browserFeature,
  dependencies: defineRendererDependencies({ host: optionalCapability(browserRendererHostCapability, () => ({ bridge: null })) }),
  messages: [browserMessages],
  setup(context) {
    registerSettingsPage(context.ui, {
      entryId: 'browser.settings-page', sectionId: 'browser', location: 'settings',
      navigationGroupId: 'preferences', order: 180, titleKey: 'feature.browser.settings.title', icon: Globe,
      pageHeading: 'view',
      render: ({ translate, ui, renderDefault }) => (
        <Suspense fallback={null}>
          <BrowserSettingsPage bridge={context.dependencies.host?.bridge ?? null} translate={translate} ui={ui}>
            {renderDefault?.()}
          </BrowserSettingsPage>
        </Suspense>
      ),
    });
    context.ui.keyed(workspacePanelSlot, {
      id: 'browser.workspace-panel',
      key: 'browser',
      priority: 100,
      render: (props) => (
        <Suspense fallback={null}>
          <BrowserWorkspacePanel {...props} />
        </Suspense>
      ),
    });
  },
});
