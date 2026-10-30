import { createHash } from 'node:crypto';
import type { ConfigStore } from '../../ports/config-store.js';
import type { RuntimeContextCompactionInput } from './runtime-context-compactor.js';

/** Includes private credentials without retaining or publishing them in a candidate or event. */
export async function compactionConfigurationKey(input: RuntimeContextCompactionInput, store?: ConfigStore): Promise<string> {
  const config = await store?.getConfig() ?? input.runtimeConfig;
  const providerIds = [...new Set([
    input.conversationModel?.providerId ?? config?.activeProviderId,
    config?.taskModels?.contextCompaction?.providerId,
  ].filter((id): id is string => Boolean(id)))];
  const providers = await Promise.all(providerIds.map(async (id) => {
    const provider = store?.getProviderConfig ? await store.getProviderConfig(id)
      : store ? await store.getActiveProviderConfig() : config?.providers.find((item) => item.id === id);
    if (provider && provider.id !== id) throw new Error('Cannot establish the compaction provider configuration.');
    return provider;
  }));
  return createHash('sha256').update(JSON.stringify({
    providers, model: input.conversationModel, taskModel: config?.taskModels?.contextCompaction,
    requestContextKey: input.requestContextKey, reservedTokens: input.reservedTokens,
    contextWindow: input.contextBudget?.maxContextTokens, autoLimit: input.contextBudget?.autoCompactTokenLimit,
    globalPrompt: config?.globalPrompt, hooks: config?.hooks, imageCompression: config?.imageCompression,
  })).digest('hex');
}
