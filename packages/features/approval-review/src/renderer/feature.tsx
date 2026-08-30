import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPageExtension } from '@setsuna-desktop/renderer-contracts/settings';
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
    registerSettingsPageExtension(context.ui, {
        entryId: 'approval-review.task-model-settings',
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
    });
  },
});
