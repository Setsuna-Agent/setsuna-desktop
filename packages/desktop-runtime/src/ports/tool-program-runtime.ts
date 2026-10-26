/** Isolated code has no host capabilities except this serialized tool bridge. */
export type ToolProgramRuntime = {
  execute(input: {
    code: string;
    toolNames: string[];
    sessionId?: string;
    toolCatalog?: Array<{ name: string; description: string }>;
    signal: AbortSignal;
    callTool(name: string, input: unknown): Promise<unknown>;
  }): Promise<string>;
  releaseThread?(threadId: string): void;
  shutdown?(): void;
};

export const TOOL_PROGRAM_TIMEOUT_MS = 120_000;
export const TOOL_PROGRAM_MAX_CALLS = 64;
export const TOOL_PROGRAM_OUTPUT_BYTES = 64 * 1024;
export const TOOL_PROGRAM_VALUE_BYTES = 2 * 1024 * 1024;
export const TOOL_PROGRAM_STATE_BYTES = 4 * 1024 * 1024;
