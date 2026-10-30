import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import type { Provider } from '@earendil-works/pi-ai';
import { DEFAULT_MODEL_MAX_OUTPUT_TOKENS, type ModelRequest } from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import { createPiModel, createPiReplayContext, toPiContext } from './pi-context.js';
import { withKnownPiRequestCompatibility, type PiModelRequest } from './pi-request-compatibility.js';
import { usesAdaptiveAnthropicThinking } from './pi-provider-stream.js';

/** Sampling and compaction must resolve defaults and replay against the same provider identity. */
export function preparePiRequest(provider: ModelProviderRuntimeConfig, input: PiModelRequest, providers?: readonly Provider[]) {
  const configured = provider.activeModel;
  const modelId = configured?.code || input.model;
  const thinking = input.thinking === true && configured?.thinkingEnabled === true;
  const defaults: ModelRequest = {
    ...input,
    model: modelId,
    sessionId: input.sessionId ?? input.stepSnapshot?.threadId,
    maxOutputTokens: input.maxOutputTokens ?? configured?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
    thinking,
    reasoningEffort: thinking
      ? input.reasoningEffort || configured?.defaultThinkingEffort || configured?.thinkingEfforts.find((effort) => effort.trim())
      : undefined,
  };
  const model = createPiModel(provider, modelId, {
    forceAdaptiveThinking: input.anthropicThinkingMode === 'adaptive' || usesAdaptiveAnthropicThinking(defaults),
    providers,
  });
  const request = withKnownPiRequestCompatibility(defaults, model);
  const replayContext = createPiReplayContext(provider, modelId, providers);
  return { request, model, replayContext, context: normalizeContext(toPiContext(request, replayContext)) };
}
