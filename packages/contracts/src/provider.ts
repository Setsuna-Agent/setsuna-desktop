import type { RuntimeMessage } from './threads.js';
import type { RuntimeUsage } from './usage.js';

export type ModelProviderKind = 'openai-compatible' | 'openai-responses' | 'anthropic';

export type RuntimeToolChoice = 'auto' | 'none' | { type: 'tool'; name: string };

export type RuntimeToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type RuntimeToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type RuntimeToolCallDelta = {
  id: string;
  name: string;
  argumentsDelta: string;
};

export type ModelRequest = {
  model: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: RuntimeToolChoice;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

export type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_delta'; call: RuntimeToolCallDelta }
  | { type: 'tool_calls'; toolCalls: RuntimeToolCall[] }
  | { type: 'usage'; usage: RuntimeUsage }
  | { type: 'done'; finishReason?: string };
