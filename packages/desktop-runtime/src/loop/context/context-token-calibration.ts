import { createHash } from 'node:crypto';
import type { ModelRequest, RuntimeConfigState, RuntimeContextUsageBaseline, RuntimeMessage, RuntimeToolDefinition, RuntimeUsage } from '@setsuna-desktop/contracts';
import { captureContextWindow, contextWindowMatches } from '../../utils/context-window-snapshot.js';
import { estimateRuntimeMessageTokens, estimateRuntimeToolDefinitionTokens } from './context-compaction.js';

type ModelIdentity = Pick<ModelRequest, 'model' | 'providerId'> & { providerFingerprint?: string };

/** Persisted prefix calibration survives turns/restarts; changed replay content invalidates it. */
export class ContextTokenCalibration {
  private baseline?: RuntimeContextUsageBaseline;

  constructor(baseline?: RuntimeContextUsageBaseline) {
    this.baseline = baseline ? structuredClone(baseline) : undefined;
  }

  record(model: ModelIdentity, messages: RuntimeMessage[], tools: RuntimeToolDefinition[] | undefined, usage: RuntimeUsage | undefined, history = messages): void {
    const actualInput = usage?.inputTokens;
    if (typeof actualInput !== 'number' || !Number.isFinite(actualInput) || actualInput <= 0) return;
    const estimatedInput = estimateRuntimeMessageTokens(messages) + estimateRuntimeToolDefinitionTokens(tools);
    this.baseline = {
      ...captureContextWindow(history),
      modelKey: modelKey(model),
      // Cached input and cumulative billing totals are not additional context.
      adjustment: Math.ceil(actualInput - estimatedInput),
    };
  }

  snapshot(): RuntimeContextUsageBaseline | undefined {
    return this.baseline ? structuredClone(this.baseline) : undefined;
  }

  adjustment(model: ModelIdentity, messages: RuntimeMessage[]): number {
    return this.baseline?.modelKey === modelKey(model) && contextWindowMatches(messages, this.baseline)
      ? this.baseline.adjustment : 0;
  }
}

export function contextModelIdentity(model: Pick<ModelRequest, 'model' | 'providerId'>, config?: RuntimeConfigState | null): ModelIdentity {
  const provider = config?.providers.find((item) => item.id === (model.providerId ?? config.activeProviderId));
  return {
    ...model,
    ...(provider ? { providerFingerprint: createHash('sha256').update(JSON.stringify([
      provider.id, provider.provider, provider.baseUrl, provider.apiKeySet, provider.apiKeyPreview, provider.requestHeaders,
    ])).digest('hex') } : {}),
  };
}

function modelKey(model: ModelIdentity): string {
  return JSON.stringify([model.providerId, model.model, model.providerFingerprint]);
}
