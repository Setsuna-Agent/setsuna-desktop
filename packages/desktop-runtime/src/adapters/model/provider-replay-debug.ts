import type {
  RuntimeMessage,
} from '@setsuna-desktop/contracts';
import type { RuntimeProviderReplayDebugPayload } from '@setsuna-desktop/feature-conversation-debug/contracts';
import { diagnoseAnthropicReplay } from './anthropic-provider-messages.js';
import { diagnoseOpenAiResponsesReplay } from './openai-responses-provider-metadata.js';
import type { ProviderReplayContext } from './provider-replay-context.js';

export function providerReplayDebugPayloads(
  messages: RuntimeMessage[],
  replayContext: ProviderReplayContext,
): RuntimeProviderReplayDebugPayload[] {
  return messages
    .filter((message) => (
      message.visibility !== 'transcript'
      && message.role === 'assistant'
    ))
    .map((message) => {
      const decision = replayContext.providerKind === 'openai-responses'
        ? diagnoseOpenAiResponsesReplay(message, replayContext)
        : replayContext.providerKind === 'anthropic'
          ? diagnoseAnthropicReplay(message, replayContext)
          : {
              nativeItemCount: 0,
              reason: 'unsupported_provider' as const,
              strategy: 'semantic' as const,
            };
      return {
        messageId: message.id,
        model: replayContext.model,
        nativeItemCount: decision.nativeItemCount,
        providerId: replayContext.providerId,
        providerKind: replayContext.providerKind,
        reason: decision.reason,
        strategy: decision.strategy,
      };
    });
}
