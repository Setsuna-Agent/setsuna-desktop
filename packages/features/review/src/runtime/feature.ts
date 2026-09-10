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
  defaultGitSettings,
  readGitSettings,
  readGitConflictHistory,
  readArchivedGitConflicts,
  deleteGitConflictTask,
  setGitConflictArchived,
  updateGitSettings,
  resolveGitConflicts,
  generateReviewCommitMessage,
  readCommitMessageSettings,
  readCommitMessagePromptSettings,
  readReviewSettings,
  reviewControlCapability,
  reviewFeature,
  reviewLegacySettingsCapability,
  reviewRuntimeHostCapability,
  reviewSettings,
  startAgentReview,
  updateReviewSettings,
  updateCommitMessageSettings,
  updateCommitMessagePromptSettings,
} from '../contracts/index.js';
import { generateRuntimeReviewCommitMessage } from './commit-message-generation.js';
import { RuntimeReviewControl } from './runtime-review-control.js';
import { RuntimeGitSettings } from './git-settings.js';
import { RuntimeGitConflictResolver } from './conflict-resolution.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(reviewRuntimeHostCapability),
  legacySettings: requiredCapability(reviewLegacySettingsCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
});

const controlProvider = declareCapabilityProvider(reviewControlCapability);

export const reviewRuntimeFeature = defineRuntimeFeature({
  definition: reviewFeature,
  provides: [controlProvider],
  dependencies,
  settings: [reviewSettings],
  async setup(context) {
    const selection = context.dependencies.settings.open(
      reviewSettings.documents['model-selection'],
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
        code: 'REVIEW_SETTINGS_INVALID',
        message: 'Review settings could not be applied.',
      });
    }

    const control = new RuntimeReviewControl(selection, context.dependencies.host);
    const gitDocument = context.dependencies.settings.open(reviewSettings.documents['git-settings']);
    if (!await gitDocument.exists()) {
      const [model, prompt] = await Promise.all([
        context.dependencies.settings.open(reviewSettings.documents['commit-message-model-selection']).read(),
        context.dependencies.settings.open(reviewSettings.documents['commit-message-prompt']).read(),
      ]);
      await gitDocument.initialize({ value: { ...defaultGitSettings(), commitMessageModel: model.value, commitMessagePrompt: prompt.value } });
    }
    const git = new RuntimeGitSettings(gitDocument, context.dependencies.host);
    const conflicts = new RuntimeGitConflictResolver(git, context.dependencies.host);
    context.dependencies.routes.register(
      context.scope,
      generateReviewCommitMessage,
      async (input, operation) => {
        const settings = await git.value();
        return {
          message: await generateRuntimeReviewCommitMessage(context.dependencies.host, input, {
            signal: operation.signal,
            onProgress: operation.reportProgress ? (message) => operation.reportProgress?.({ message }) : undefined,
            selection: settings.commitMessageModel,
            prompt: settings.commitMessagePrompt,
          }),
        };
      },
    );
    context.dependencies.routes.register(
      context.scope,
      startAgentReview,
      async (input) => (await control.start(input)).response,
    );
    context.dependencies.routes.register(
      context.scope,
      readReviewSettings,
      () => control.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateReviewSettings,
      (input) => control.updateSettings(input),
    );
    context.dependencies.routes.register(
      context.scope,
      readCommitMessageSettings,
      () => git.readModel('commitMessageModel'),
    );
    context.dependencies.routes.register(
      context.scope,
      updateCommitMessageSettings,
      (input) => git.updateModel('commitMessageModel', input.expectedRevision, input.selection),
    );
    context.dependencies.routes.register(context.scope, readGitSettings, () => git.read());
    context.dependencies.routes.register(context.scope, updateGitSettings, (input) => git.update(input.expectedRevision, input.settings));
    context.dependencies.routes.register(context.scope, resolveGitConflicts, (input) => conflicts.start(input));
    context.dependencies.routes.register(context.scope, readGitConflictHistory, (input) => context.dependencies.host.listGitConflictTasks(input.workspaceRoot));
    context.dependencies.routes.register(context.scope, setGitConflictArchived, (input) => context.dependencies.host.setGitConflictArchived(input));
    context.dependencies.routes.register(context.scope, readArchivedGitConflicts, () => context.dependencies.host.listArchivedGitConflicts());
    context.dependencies.routes.register(context.scope, deleteGitConflictTask, (input) => context.dependencies.host.deleteGitConflictTask(input));
    context.provide(controlProvider, control);
    context.dependencies.routes.register(
      context.scope,
      readCommitMessagePromptSettings,
      async () => { const state = await git.read(); return { prompt: state.settings.commitMessagePrompt, revision: state.revision }; },
    );
    context.dependencies.routes.register(
      context.scope,
      updateCommitMessagePromptSettings,
      async (input) => { const state = await git.update(input.expectedRevision, { commitMessagePrompt: input.prompt }); return { prompt: state.settings.commitMessagePrompt, revision: state.revision }; },
    );

    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});
