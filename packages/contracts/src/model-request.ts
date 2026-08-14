import type { RuntimeModelRequestStepSnapshot, RuntimeToolChoice, RuntimeToolDefinition } from './provider.js';
import type { RuntimeMessage } from './threads.js';

export type ModelResponseFormat = {
  type: 'json';
  name?: string;
  description?: string;
  schema?: Record<string, unknown>;
};

export type ModelRequest = {
  model: string;
  /** Selects a configured provider for background task requests. */
  providerId?: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: RuntimeToolChoice;
  stepSnapshot?: RuntimeModelRequestStepSnapshot;
  maxOutputTokens?: number;
  temperature?: number;
  thinking?: boolean;
  reasoningEffort?: string;
  responseFormat?: ModelResponseFormat;
  signal?: AbortSignal;
};
