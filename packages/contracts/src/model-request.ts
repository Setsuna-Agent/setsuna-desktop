import type { RuntimeModelRequestStepSnapshot, RuntimeToolChoice, RuntimeToolDefinition } from './provider.js';
import type { RuntimeMessage } from './threads.js';

export type ModelRequest = {
  model: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: RuntimeToolChoice;
  stepSnapshot?: RuntimeModelRequestStepSnapshot;
  maxOutputTokens?: number;
  temperature?: number;
  thinking?: boolean;
  reasoningEffort?: string;
  signal?: AbortSignal;
};
