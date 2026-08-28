import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { approvalReviewFeature } from '../contracts/index.js';
import { ApprovalReviewSettingsView } from './ApprovalReviewSettingsView.js';
import { createApprovalReviewClient } from './client.js';
import { approvalReviewMessages } from './messages.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

export const approvalReviewRendererFeature = defineRendererFeature({
  definition: approvalReviewFeature,
  dependencies,
  messages: [approvalReviewMessages],
  setup(context) {
    const client = createApprovalReviewClient(context.dependencies.transport);
    return {
      settingsSectionExtensions: [{
        id: 'approval-review-task-model',
        targetSectionId: 'taskModels',
        order: 200,
        render: ({ translate, ui }) => (
          <ApprovalReviewSettingsView
            client={client}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    };
  },
});
