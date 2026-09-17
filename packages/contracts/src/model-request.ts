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
  /** Stable conversation or task identity, shared across model rounds and retries. */
  sessionId?: string;
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

export type ModelCompactionRequest = Pick<ModelRequest, 'model' | 'providerId' | 'sessionId' | 'messages' | 'signal'>;

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

/** Metadata only. Never include prompts, output, request headers or provider error bodies. */
export type ModelDiagnostic = {
  phase: string;
  requestId?: string;
  threadId?: string;
  turnId?: string;
  stepSeq?: number;
  providerId?: string;
  model?: string;
  elapsedMs?: number;
  attempt?: number;
  requestBytes?: number;
  responseBytes?: number;
  status?: number;
  aborted?: boolean;
  thinking?: boolean;
  reasoningEffort?: string;
  messageCount?: number;
  imageCount?: number;
  toolCount?: number;
  maxOutputTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  eventSeq?: number;
  eventAt?: string;
};

export type ModelDiagnosticReporter = (record: ModelDiagnostic) => void;
