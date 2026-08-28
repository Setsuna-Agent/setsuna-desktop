import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  approvalReviewControlCapability,
  approvalReviewFeature,
  approvalReviewLegacySettingsCapability,
  approvalReviewRuntimeHostCapability,
  approvalReviewSettings,
  readApprovalReviewSettings,
  updateApprovalReviewSettings,
} from '../contracts/index.js';
import { AutomaticApprovalReviewControl } from './automatic-approval-reviewer.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  host: requiredCapability(approvalReviewRuntimeHostCapability),
  legacySettings: requiredCapability(approvalReviewLegacySettingsCapability),
});

export const approvalReviewRuntimeFeature = defineRuntimeFeature({
  definition: approvalReviewFeature,
  provides: [declareCapabilityProvider(approvalReviewControlCapability)],
  dependencies,
  settings: [approvalReviewSettings],
  async setup(context) {
    const selection = context.dependencies.settings.open(
      approvalReviewSettings.documents['model-selection'],
    );
    let settingsReady = false;
    try {
      if (!await selection.exists()) {
        await selection.initialize({
          value: await context.dependencies.legacySettings.read(),
        });
      }
      await selection.read();
      settingsReady = true;
    } catch {
      context.health.setCondition('settings', {
        code: 'APPROVAL_REVIEW_SETTINGS_INVALID',
        message: 'Approval review settings could not be applied.',
      });
    }

    const control = new AutomaticApprovalReviewControl(
      context.scope,
      selection,
      context.dependencies.host,
    );
    context.dependencies.routes.register(
      context.scope,
      readApprovalReviewSettings,
      () => control.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateApprovalReviewSettings,
      (input) => control.updateSettings(input),
    );
    context.provide(declareCapabilityProvider(approvalReviewControlCapability), control);

    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});
