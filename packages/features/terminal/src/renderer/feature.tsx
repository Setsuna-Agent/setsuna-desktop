import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { terminalFeature } from '../contracts/index.js';
import { terminalMessages } from './messages.js';
import { TerminalWorkspacePanel } from './TerminalWorkspacePanel.js';

export const terminalRendererFeature = defineRendererFeature({
  definition: terminalFeature,
  dependencies: defineRendererDependencies({}),
  messages: [terminalMessages],
  setup(context) {
    context.ui.keyed(workspacePanelSlot, {
      id: 'terminal.workspace-panel',
      key: 'terminal',
      priority: 100,
      render: (props) => <TerminalWorkspacePanel {...props} />,
    });
  },
});
