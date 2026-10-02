import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature } from '@setsuna-desktop/feature-core/renderer';
import { shellTopbarActionSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { Monitor } from 'lucide-react';
import { computerBridgeCapability, computerUseFeature } from '../contracts/index.js';
import { ComputerControlPreview } from './ComputerControlPreview.js';
import { ComputerSettingsView } from './ComputerSettingsView.js';
import { computerUseMessages } from './messages.js';

export const computerRendererFeature = defineRendererFeature({
  definition: computerUseFeature,
  dependencies: defineRendererDependencies({ bridge: requiredCapability(computerBridgeCapability) }),
  messages: [computerUseMessages],
  setup(context) {
    registerSettingsPage(context.ui, {
      entryId: 'computer-use.settings-page', sectionId: 'computer-use', location: 'settings',
      navigationGroupId: 'models-and-services', order: 260, icon: Monitor,
      titleKey: 'feature.computerUse.title', pageHeading: 'view',
      render: ({ translate, ui }) => <ComputerSettingsView bridge={context.dependencies.bridge} translate={translate} ui={ui} />,
    });
    context.ui.list(shellTopbarActionSlot, {
      id: 'computer-use.stop', order: -1000,
      render: (props) => <ComputerControlPreview bridge={context.dependencies.bridge} ui={props.ui} translate={props.translate} />,
    });
  },
});
