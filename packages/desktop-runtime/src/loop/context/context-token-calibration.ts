import type { ModelRequest, RuntimeMessage, RuntimeToolDefinition, RuntimeUsage } from '@setsuna-desktop/contracts';
import { estimateRuntimeMessageTokens, estimateRuntimeToolDefinitionTokens } from './context-compaction.js';

type ModelIdentity = Pick<ModelRequest, 'model' | 'providerId'>;

/** Turn-local calibration. Billing totals and cached input are never added to context a second time. */
export class ContextTokenCalibration {
  private baseline?: { key: string; adjustment: number };

  record(model: ModelIdentity, messages: RuntimeMessage[], tools: RuntimeToolDefinition[] | undefined, usage: RuntimeUsage | undefined): void {
    const actualInput = usage?.inputTokens;
    if (typeof actualInput !== 'number' || !Number.isFinite(actualInput) || actualInput <= 0) {
      this.baseline = undefined;
      return;
    }
    const estimatedInput = estimateRuntimeMessageTokens(messages) + estimateRuntimeToolDefinitionTokens(tools);
    this.baseline = {
      key: windowKey(model, messages),
      // Keep the local estimate as a conservative floor. The difference carries forward while
      // newly appended messages and newly loaded tool schemas are estimated independently.
      adjustment: Math.max(0, Math.ceil(actualInput - estimatedInput)),
    };
  }

  adjustment(model: ModelIdentity, messages: RuntimeMessage[]): number {
    return this.baseline?.key === windowKey(model, messages) ? this.baseline.adjustment : 0;
  }
}

function windowKey(model: ModelIdentity, messages: RuntimeMessage[]): string {
  return JSON.stringify([model.providerId, model.model, messages
    .filter((message) => message.visibility !== 'transcript' && message.contextCompaction)
    .map((message) => message.id)]);
}
