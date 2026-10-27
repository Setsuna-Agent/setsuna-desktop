import {
  parseRuntimePluginUiData,
  runtimePluginUiSecretFields,
  type RuntimePluginUiDataInput,
  type RuntimePluginUiDataResult,
} from '@setsuna-desktop/contracts';
import type { ExtensionStateStore } from '../ports/extension-runtime.js';
import type { InstalledPluginRecord, PluginBundleStore } from '../ports/plugin-bundle-store.js';
import type { ExtensionSecretStore } from './extension-secret-store.js';
import { assertRendererUiScopeContext } from './extension-renderer-ui-policy.js';
import { stateScope } from './extension-state-scope.js';

/** Reads a declared view without starting its worker or exposing credential values. */
export async function readExtensionRendererUiData(
  input: RuntimePluginUiDataInput,
  host: Readonly<{
    plugins: Pick<PluginBundleStore, 'listInstalledRecords'>;
    state: Pick<ExtensionStateStore, 'get'>;
    secrets?: ExtensionSecretStore;
    verify(plugin: InstalledPluginRecord): Promise<void>;
  }>,
): Promise<RuntimePluginUiDataResult> {
  const plugin = (await host.plugins.listInstalledRecords()).find((candidate) => candidate.id === input.pluginId);
  if (!plugin?.extension) throw new Error(`Extension plugin is not installed: ${input.pluginId}`);
  const rendererUi = plugin.extension.rendererUi;
  if (!rendererUi || !plugin.extension.capabilities.includes('ui')) {
    throw new Error(`Extension did not declare Renderer UI: ${input.pluginId}`);
  }
  const contribution = rendererUi.contributions.find((candidate) => (
    candidate.id === input.context.contributionId && candidate.slot === input.context.surface
  ));
  const secretFields = runtimePluginUiSecretFields(contribution?.tree);
  if (!contribution || (!contribution.data && !secretFields.length)) {
    throw new Error(`Extension Renderer UI contribution does not declare data: ${input.context.contributionId}`);
  }
  if (contribution.data) {
    if (!plugin.extension.capabilities.includes('state')) throw new Error('Extension did not declare state for Renderer UI data.');
    assertRendererUiScopeContext(contribution.data.scope, input.context);
  }
  await host.verify(plugin);
  const scope = stateScope(contribution.data?.scope ?? 'global', {
    threadId: input.context.threadId ?? `renderer-ui:${plugin.id}`,
    ...(input.context.projectId ? { projectId: input.context.projectId } : {}),
  });
  const value = contribution.data ? await host.state.get(plugin.id, scope, contribution.data.stateKey) : {};
  if (secretFields.length && !host.secrets) throw new Error('Plugin credential storage is unavailable.');
  const configuredSecrets = secretFields.length ? await host.secrets!.configured(plugin.id, secretFields) : undefined;
  return Object.freeze({
    data: parseRuntimePluginUiData(value ?? {}),
    ...(configuredSecrets ? { configuredSecrets } : {}),
  });
}
