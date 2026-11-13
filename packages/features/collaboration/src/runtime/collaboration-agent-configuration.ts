import type { RuntimeConfiguredModelReference, RuntimeInterfaceLanguage, RuntimeThread } from '@setsuna-desktop/contracts';
import {
  agentReasoningEffort, collaborationModelSelectionCodec, resolveCollaborationRoleText,
  type CollaborationAgentSettings, type CollaborationRuntimeHost,
} from '../contracts/index.js';
import { optionalString } from './collaboration-input.js';

export async function resolveCollaborationAgentConfiguration(
  host: CollaborationRuntimeHost,
  parent: RuntimeThread,
  settings: CollaborationAgentSettings,
  input: Record<string, unknown>,
  language: RuntimeInterfaceLanguage,
) {
  const roleName = optionalString(input, ['role']) || 'default';
  const role = settings.roles.find((role) => role.name === roleName);
  if (!role) throw new Error(`Unknown agent role: ${roleName}. Use list_agent_profiles.`);
  const roleText = resolveCollaborationRoleText(role, language);
  // Only user settings select a different model. Model-authored arguments can confirm that
  // selection, but must never enter the trusted host resolver as a model override.
  const configuration = {
    ...await host.resolveAgentConfiguration(parent, {
      role: role.name, instructions: roleText.instructions, model: role.model ?? settings.model,
      reasoningEffort: input.reasoning_effort !== undefined
        ? agentReasoningEffort(input.reasoning_effort) : role.reasoningEffort ?? settings.reasoningEffort,
    }),
    description: roleText.description,
  };
  const requested = collaborationModelSelectionCodec.parse(input.model);
  if (requested && !sameModel(requested, configuration.modelBinding)) {
    throw new Error('Agent model is restricted to the selected role settings, global agent settings, or the current parent conversation model. Omit model or use the selected role model from list_agent_profiles.');
  }
  return { role, configuration };
}

export async function listCollaborationAgentProfiles(
  host: CollaborationRuntimeHost,
  parent: RuntimeThread,
  settings: CollaborationAgentSettings,
  language: RuntimeInterfaceLanguage,
) {
  const inherited = !settings.model && settings.roles.some((role) => !role.model)
    ? await host.resolveAgentConfiguration(parent, { role: 'default', instructions: '', model: null, reasoningEffort: null })
    : undefined;
  const binding = inherited?.modelBinding;
  const defaultModel = settings.model ?? (binding ? { providerId: binding.providerId, modelId: binding.modelId } : null);
  const roles = settings.roles.map((role) => ({
    name: role.name, model: role.model ?? defaultModel, reasoningEffort: role.reasoningEffort,
    description: resolveCollaborationRoleText(role, language).description,
  }));
  const models = await host.listModels();
  return {
    defaults: { model: defaultModel, reasoningEffort: settings.reasoningEffort },
    roles,
    availableModels: models.filter((model) => roles.some((role) => sameModel(model, role.model))),
    status: 'completed',
  };
}

function sameModel(left: RuntimeConfiguredModelReference, right: RuntimeConfiguredModelReference | null | undefined): boolean {
  return left.providerId === right?.providerId && left.modelId === right.modelId;
}
