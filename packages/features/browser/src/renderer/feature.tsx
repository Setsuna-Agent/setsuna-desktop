import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { lazy, Suspense } from 'react';
import { browserFeature } from '../contracts/index.js';
import { browserMessages } from './messages.js';

const BrowserWorkspacePanel = lazy(async () => {
  const module = await import('./BrowserWorkspacePanel.js');
  return { default: module.BrowserWorkspacePanel };
});

export const browserRendererFeature = defineRendererFeature({
  definition: browserFeature,
  dependencies: defineRendererDependencies({}),
  messages: [browserMessages],
  setup(context) {
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
