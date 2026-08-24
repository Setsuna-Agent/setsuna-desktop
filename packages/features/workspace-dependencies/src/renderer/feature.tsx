import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { workspaceDependenciesFeature } from '../contracts/index.js';
import { createWorkspaceDependenciesClient } from './client.js';
import { workspaceDependenciesMessages } from './messages.js';
import { WorkspaceDependenciesSettingsView } from './WorkspaceDependenciesSettingsView.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

export const workspaceDependenciesRendererFeature = defineRendererFeature({
  definition: workspaceDependenciesFeature,
  dependencies,
  messages: [workspaceDependenciesMessages],
  setup(context) {
    const client = createWorkspaceDependenciesClient(context.dependencies.transport);
    return {
      settingsSectionExtensions: [{
        id: 'workspace-dependencies',
        targetSectionId: 'runtime',
        order: 200,
        render: ({ translate, ui }) => (
          <WorkspaceDependenciesSettingsView client={client} translate={translate} ui={ui} />
        ),
      }],
    };
  },
});
