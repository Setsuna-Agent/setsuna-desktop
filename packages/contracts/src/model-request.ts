import type { RuntimeModelRequestStepSnapshot, RuntimeToolChoice, RuntimeToolDefinition } from './provider.js';
import type { RuntimeMessageProviderMetadata } from './message-metadata.js';
import type { RuntimeMessage } from './threads.js';
import type { RuntimeUsage } from './usage.js';

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

export type ModelCompactionRequest = Pick<ModelRequest, 'model' | 'providerId' | 'messages' | 'signal'>;

export type ModelCompactionResult =
  | {
      kind: 'summary';
      summary: string;
      usage?: RuntimeUsage;
    }
  | {
      kind: 'native';
      providerMetadata: RuntimeMessageProviderMetadata;
      usage?: RuntimeUsage;
    };
