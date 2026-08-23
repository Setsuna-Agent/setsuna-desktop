import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererComposerStatusViewRegistryCapability,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { goalFeature } from '../contracts/index.js';
import { createGoalClient } from './client.js';
import { GoalComposerStatusView } from './GoalComposerStatusView.js';
import { goalMessages } from './messages.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  eventFeed: requiredCapability(rendererFeatureEventFeedCapability),
  composerStatuses: requiredCapability(rendererComposerStatusViewRegistryCapability),
});

export const goalRendererFeature = defineRendererFeature({
  definition: goalFeature,
  dependencies,
  messages: [goalMessages],
  setup(context) {
    const client = createGoalClient(context.dependencies.transport);
    const feed = context.dependencies.eventFeed;
    const scope = context.scope;
    context.dependencies.composerStatuses.register(scope, {
      id: 'goal.composer-status',
      order: 100,
      render: (props) => (
        <GoalComposerStatusView
          {...props}
          client={client}
          feed={feed}
          scope={scope}
        />
      ),
    });
  },
});
