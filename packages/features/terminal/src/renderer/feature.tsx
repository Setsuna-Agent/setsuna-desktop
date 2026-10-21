import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { FolderCog } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { terminalFeature } from '../contracts/index.js';
import { terminalMessages } from './messages.js';
import { TerminalWorkspacePanel } from './TerminalWorkspacePanel.js';

const TerminalActionSettingsPage = lazy(async () => ({
  default: (await import('./actions/TerminalActionSettingsPage.js')).TerminalActionSettingsPage,
}));

export const terminalRendererFeature = defineRendererFeature({
  definition: terminalFeature,
  dependencies: defineRendererDependencies({}),
  messages: [terminalMessages],
  setup(context) {
    registerSettingsPage(context.ui, {
      entryId: 'terminal.environment-settings', sectionId: 'environments', location: 'settings',
      navigationGroupId: 'workspace', order: 100, titleKey: 'feature.terminal.actions.environments', icon: FolderCog,
      pageHeading: 'view',
      render: (props) => <Suspense fallback={null}><TerminalActionSettingsPage {...props} /></Suspense>,
    });
    context.ui.keyed(workspacePanelSlot, {
      id: 'terminal.workspace-panel',
      key: 'terminal',
      priority: 100,
      render: (props) => <TerminalWorkspacePanel {...props} />,
    });
  },
});
