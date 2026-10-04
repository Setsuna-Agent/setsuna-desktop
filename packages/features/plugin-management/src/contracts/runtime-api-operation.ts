import {
  parseRuntimeApiRequest, parseRuntimeApiResponse, type RuntimePluginUiRuntimeRequest,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export const requestInstalledPluginRuntimeApi = defineFeatureOperation({
  id: 'plugin-management.runtime-api.request',
  method: 'POST',
  path: '/v1/features/plugin-management/installed/:pluginId/renderer-ui/runtime-request',
  input: defineRuntimeCodec<RuntimePluginUiRuntimeRequest>((value) => {
    if (!value || typeof value !== 'object') throw new Error('Plugin runtime request must be an object.');
    const input = value as Record<string, unknown>;
    if (typeof input.pluginId !== 'string' || !input.pluginId.trim()
      || typeof input.contributionId !== 'string' || !input.contributionId.trim()) {
      throw new Error('Plugin runtime request requires a plugin and contribution.');
    }
    return { pluginId: input.pluginId, contributionId: input.contributionId, request: parseRuntimeApiRequest(input.request) };
  }),
  output: defineRuntimeCodec(parseRuntimeApiResponse),
  errors: { PLUGIN_OPERATION_FAILED: { status: 500 } },
  idempotency: 'non-idempotent',
});
