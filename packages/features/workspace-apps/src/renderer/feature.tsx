import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { shellTopbarActionSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { workspaceAppsFeature } from '../contracts/index.js';
import { workspaceAppsMessages } from './messages.js';
import { WorkspaceAppsTopbarAction } from './WorkspaceAppsTopbarAction.js';

export const workspaceAppsRendererFeature = defineRendererFeature({
  definition: workspaceAppsFeature,
  dependencies: defineRendererDependencies({}),
  messages: [workspaceAppsMessages],
  setup(context) {
    context.ui.list(shellTopbarActionSlot, {
      id: 'workspace-apps.launcher',
      order: 50,
      render: (props) => <WorkspaceAppsTopbarAction {...props} />,
    });
  },
});
