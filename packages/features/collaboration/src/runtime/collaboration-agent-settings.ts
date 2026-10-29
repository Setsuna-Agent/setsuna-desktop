import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { FeatureSettingsRevisionConflictError, type RuntimeFeatureSettingsDocumentHandle } from '@setsuna-desktop/feature-core/settings';
import type { CollaborationAgentSettings, CollaborationRuntimeHost, CollaborationSettingsState, CollaborationSettingsUpdate } from '../contracts/index.js';

type Handle = Pick<RuntimeFeatureSettingsDocumentHandle<CollaborationAgentSettings, CollaborationAgentSettings, CollaborationAgentSettings, undefined>, 'read' | 'update'>;

/** Settings are loaded on demand; no model/catalog IO is added to runtime readiness. */
export class CollaborationAgentSettingsStore {
  constructor(private readonly handle: Handle, private readonly host: CollaborationRuntimeHost) {}

  async value(): Promise<CollaborationAgentSettings> { return (await this.handle.read()).value; }

  async read(): Promise<CollaborationSettingsState> {
    const [state, availableModels] = await Promise.all([this.handle.read(), this.host.listModels()]);
    return { settings: state.value, revision: state.revision, availableModels };
  }

  async update(input: CollaborationSettingsUpdate): Promise<CollaborationSettingsState> {
    try {
      const models = await this.host.listModels();
      for (const entry of [input.settings, ...input.settings.roles]) {
        const reference = entry.model ?? input.settings.model;
        const effort = entry.reasoningEffort ?? input.settings.reasoningEffort;
        if (!reference) continue;
        const model = models.find((model) => model.providerId === reference.providerId && model.modelId === reference.modelId);
        if (!model) throw new FeatureOperationFailure({ code: 'INVALID_CONFIGURATION', message: 'The selected agent model is unavailable.', retryable: false });
        if (effort && effort !== 'none' && !model.reasoningEfforts.includes(effort)) {
          throw new FeatureOperationFailure({ code: 'INVALID_CONFIGURATION', message: 'The selected agent model does not support this reasoning effort.', retryable: false });
        }
      }
      await this.handle.update({ expectedRevision: input.expectedRevision, patch: input.settings });
      return this.read();
    } catch (error) {
      if (error instanceof FeatureSettingsRevisionConflictError) throw new FeatureOperationFailure({ code: 'REVISION_CONFLICT', message: error.message, retryable: true });
      throw error;
    }
  }
}
