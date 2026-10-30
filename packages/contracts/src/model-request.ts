import type { RuntimeModelRequestStepSnapshot, RuntimeToolChoice, RuntimeToolDefinition } from './provider.js';
import type { RuntimeMessageProviderMetadata } from './message-metadata.js';
import type { RuntimeMessage } from './threads.js';
import type { RuntimeUsage, RuntimeUsageContext } from './usage.js';

export const MODEL_REQUEST_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;

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
  usageContext?: RuntimeUsageContext;
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

/** The same prepared request as sampling; native compaction needs instructions, tools and replay state. */
export type ModelCompactionRequest = Omit<ModelRequest, 'responseFormat'> & {
  /** Observe billable usage even if validation or installation later fails. */
  onUsage?: (usage: RuntimeUsage) => void;
};

export type ModelCompactionResult =
  | { kind: 'unsupported'; usage?: RuntimeUsage }
  /** The full native window cannot be accepted; use lossless batching, without caching lack of support. */
  | { kind: 'context_limit'; usage?: RuntimeUsage }
  | {
      kind: 'summary';
      summary: string;
      usage?: RuntimeUsage;
    }
  | {
      kind: 'native';
      /** Missing on legacy clients means a standalone replacement of the submitted history. */
      mode?: 'responses-v2' | 'responses-compact';
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
