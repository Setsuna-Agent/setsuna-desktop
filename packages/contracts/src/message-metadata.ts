export type RuntimeMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export type RuntimeMessagePromptSource = 'hook' | 'plan' | 'review' | 'goal' | 'runtime_context';

export type RuntimeAnthropicContentBlock =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type RuntimeMessageProviderMetadata = {
  anthropic?: {
    /** Exact assistant blocks required when a tool result continues an Anthropic thinking turn. */
    contentBlocks: RuntimeAnthropicContentBlock[];
  };
};
